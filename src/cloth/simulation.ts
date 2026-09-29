import type { ClothLayout, WindControls, GrabControls } from "../studio/config";
import { INITIAL_GRAB } from "../studio/config";
import { createContact, vertexFaceContact, edgeEdgeContact, type Contact } from "./contactMath";
import { SpatialHash } from "./spatialHash";

export const FIXED_STEP = 1 / 120;
const MAX_STEPS = 6;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
type Topology = {
  triangles: Uint16Array;
  active: Uint16Array;
  inverseMass: Float32Array;
  edges: Uint16Array;
  lengths: Float32Array;
  bends: Uint16Array;
  bendWeights: Float32Array;
  bendFactors: Float32Array;
  adjacent: Set<number>[];
  tetherAnchors: Uint16Array;
  tetherLengths: Float32Array;
};
type Grab = { indices: number[]; weights: number[]; offsets: number[]; target: number[]; requested: number[]; stressTime: number };
export type PhysicsTimings = { integrate: number; constraints: number; contacts: number; normals: number; total: number; steps: number; contactsCount: number; droppedTime: number };

function makeTopology(rest: Float32Array, triangles: Uint16Array, pinned: Uint8Array): Topology {
  const count = rest.length / 3;
  const area = new Float32Array(count);
  const adjacent = Array.from({ length: count }, (_, i) => new Set([i]));
  const edges = new Map<number, { a: number; b: number; opposite: number[] }>();
  const addEdge = (a: number, b: number, opposite: number) => {
    if (a > b) [a, b] = [b, a];
    const key = a * count + b;
    const existing = edges.get(key);
    if (existing) existing.opposite.push(opposite);
    else edges.set(key, { a, b, opposite: [opposite] });
    adjacent[a].add(b); adjacent[b].add(a);
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const x = rest[b * 3] - rest[a * 3], y = rest[b * 3 + 1] - rest[a * 3 + 1];
    const xx = rest[c * 3] - rest[a * 3], yy = rest[c * 3 + 1] - rest[a * 3 + 1];
    const contribution = Math.abs(x * yy - y * xx) / 6;
    area[a] += contribution; area[b] += contribution; area[c] += contribution;
    addEdge(a, b, c); addEdge(b, c, a); addEdge(c, a, b);
  }
  const active: number[] = [], inverseMass = new Float32Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) if (area[i] > 0) { active.push(i); sum += area[i]; }
  const mean = sum / Math.max(1, active.length);
  for (const i of active) inverseMass[i] = pinned[i] ? 0 : mean / area[i];
  const ends: number[] = [], lengths: number[] = [], bends: number[] = [], bendWeights: number[] = [], bendFactors: number[] = [];
  for (const { a, b, opposite } of edges.values()) {
    ends.push(a, b);
    lengths.push(Math.hypot(rest[b * 3] - rest[a * 3], rest[b * 3 + 1] - rest[a * 3 + 1]));
    if (opposite.length !== 2) continue;
    const [c, d] = opposite;
    const ex = rest[b * 3] - rest[a * 3], ey = rest[b * 3 + 1] - rest[a * 3 + 1];
    const cx = rest[c * 3] - rest[a * 3], cy = rest[c * 3 + 1] - rest[a * 3 + 1];
    const dx = rest[d * 3] - rest[a * 3], dy = rest[d * 3 + 1] - rest[a * 3 + 1];
    const areaC = Math.abs(ex * cy - ey * cx), areaD = Math.abs(ex * dy - ey * dx);
    if (areaC < 1e-10 || areaD < 1e-10) continue;
    const c0 = (ex * cx + ey * cy) / areaC, c1 = (ex * (ex - cx) + ey * (ey - cy)) / areaC;
    const d0 = (ex * dx + ey * dy) / areaD, d1 = (ex * (ex - dx) + ey * (ey - dy)) / areaD;
    // Cotangent hinge energy: zero for the rest plane, invariant under rotation.
    bends.push(a, b, c, d);
    bendWeights.push(c1 + d1, c0 + d0, -c0 - c1, -d0 - d1);
    bendFactors.push(6 / (areaC + areaD));
  }
  // Geodesic tethers transmit the anchor load without hundreds of local iterations.
  // Paths follow surviving edges, so a tear cannot tether a disconnected island.
  const tetherAnchors = new Uint16Array(count).fill(65535);
  const tetherLengths = new Float32Array(count).fill(Infinity);
  const visited = new Uint8Array(count);
  for (const id of active) if (pinned[id]) { tetherAnchors[id] = id; tetherLengths[id] = 0; }
  for (let pass = 0; pass < active.length; pass++) {
    let nearest = -1, distance = Infinity;
    for (const id of active) if (!visited[id] && tetherLengths[id] < distance) { nearest = id; distance = tetherLengths[id]; }
    if (nearest < 0) break;
    visited[nearest] = 1;
    for (const next of adjacent[nearest]) {
      const candidate = distance + Math.hypot(rest[next * 3] - rest[nearest * 3], rest[next * 3 + 1] - rest[nearest * 3 + 1]);
      if (candidate < tetherLengths[next]) { tetherLengths[next] = candidate; tetherAnchors[next] = tetherAnchors[nearest]; }
    }
  }
  return { triangles, active: new Uint16Array(active), inverseMass, edges: new Uint16Array(ends), lengths: new Float32Array(lengths), bends: new Uint16Array(bends), bendWeights: new Float32Array(bendWeights), bendFactors: new Float32Array(bendFactors), adjacent, tetherAnchors, tetherLengths };
}

export class ClothSimulation {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly renderPositions: Float32Array;
  readonly normals: Float32Array;
  readonly rest: Float32Array;
  readonly pinned: Uint8Array;
  readonly timings: PhysicsTimings = { integrate: 0, constraints: 0, contacts: 0, normals: 0, total: 0, steps: 0, contactsCount: 0, droppedTime: 0 };
  private previous: Float32Array;
  private lastTick: Float32Array;
  private topologies: [Topology, Topology];
  private topology: Topology;
  private stretchLambda: Float32Array;
  private bendLambda: Float32Array;
  private faceHash: SpatialHash;
  private edgeHash: SpatialHash;
  private faceBounds: Float32Array;
  private edgeBounds: Float32Array;
  private contacts: Contact[] = [];
  private contactCount = 0;
  private contactCorrections: number[] = [];
  private ids = [0, 0, 0, 0];
  private accumulator = 0;
  private time = 0;
  private iterations = 4;
  private thickness = 0.012;
  private bendCompliance = 0.008;
  private grab: Grab | null = null;
  private grabSettings = { ...INITIAL_GRAB };
  private motion = 0;
  private impact = 0;
  private audioEnabled = false;
  private softPins: { index: number; strength: number }[] = [];
  private safePositions: Float32Array;
  private reverseStretch = false;

  constructor(rest: Float32Array, private columns: number, private rows: number, private layout: ClothLayout, intact: Uint16Array, torn: Uint16Array) {
    this.rest = new Float32Array(rest);
    this.positions = new Float32Array(rest);
    this.previous = new Float32Array(rest);
    this.lastTick = new Float32Array(rest);
    this.safePositions = new Float32Array(rest);
    this.renderPositions = new Float32Array(rest);
    this.velocities = new Float32Array(rest.length);
    this.normals = new Float32Array(rest.length);
    this.pinned = new Uint8Array(rest.length / 3);
    const top = layout.anchor === "top", anchorCount = top ? columns + 1 : rows + 1;
    const hard = Math.max(1, Math.round(anchorCount * 0.07)), soft = Math.max(1, Math.round(anchorCount * 0.06));
    for (let a = 0; a < anchorCount; a++) {
      const distance = Math.min(a, anchorCount - 1 - a), index = top ? a : a * (columns + 1);
      if (distance < hard) this.pinned[index] = 1;
      else if (distance < hard + soft) this.softPins.push({ index, strength: (1 - (distance - hard + 1) / (soft + 1)) ** 1.35 });
    }
    this.topologies = [makeTopology(rest, intact, this.pinned), makeTopology(rest, torn, this.pinned)];
    this.topology = this.topologies[0];
    this.stretchLambda = new Float32Array(this.topology.lengths.length);
    this.bendLambda = new Float32Array(this.topology.bendFactors.length);
    const cell = Math.max(layout.width / columns, layout.height / rows) * 1.6;
    this.faceHash = new SpatialHash(cell, intact.length / 3);
    this.edgeHash = new SpatialHash(cell, this.topology.edges.length / 2);
    this.faceBounds = new Float32Array(intact.length * 2);
    this.edgeBounds = new Float32Array(this.topology.edges.length * 3);
    this.reset();
  }

  get activeCount() { return this.topology.active.length; }
  get triangles() { return this.topology.triangles; }
  get edges() { return this.topology.edges; }
  get isGrabbed() { return this.grab !== null; }
  get simulationTime() { return this.time; }
  get contactTotal() { return this.contactCount; }
  setBudget(level: number) { this.iterations = Math.round(clamp(level, 3, 5)); }
  setAudioEnabled(enabled: boolean) { this.audioEnabled = enabled; }
  configureMaterial(thickness: number, preset: number) {
    this.thickness = clamp(thickness * 1.25, 0.008, 0.1);
    this.bendCompliance = preset === 1 ? 0.018 : preset === 2 ? 0.004 : 0.008;
  }
  setGrabSettings(settings: GrabControls) { this.grabSettings = { ...settings }; }
  setTorn(enabled: boolean) {
    this.topology = this.topologies[enabled ? 1 : 0];
    this.releaseGrab(); this.accumulator = 0;
    // No hidden vertex retains velocity or participates in the new constraint graph.
    const active = new Set(this.topology.active);
    for (let i = 0; i < this.pinned.length; i++) if (!active.has(i)) {
      for (let j = 0; j < 3; j++) { this.positions[i * 3 + j] = this.rest[i * 3 + j]; this.velocities[i * 3 + j] = 0; }
    }
    this.previous.set(this.positions); this.lastTick.set(this.positions); this.renderPositions.set(this.positions);
    this.safePositions.set(this.positions);
    this.updateNormals();
  }
  reset() {
    this.positions.set(this.rest); this.velocities.fill(0); this.accumulator = 0; this.time = 0;
    this.reverseStretch = false;
    this.releaseGrab(); this.contactCount = 0; this.motion = 0; this.impact = 0;
    for (const i of this.topology.active) if (!this.pinned[i]) {
      const u = i % (this.columns + 1) / this.columns, v = Math.floor(i / (this.columns + 1)) / this.rows;
      this.positions[i * 3 + 2] = Math.sin(i * 1.73) * 0.002 * (this.layout.anchor === "top" ? v : u);
    }
    this.previous.set(this.positions); this.lastTick.set(this.positions); this.renderPositions.set(this.positions); this.safePositions.set(this.positions);
    this.updateNormals();
  }
  resetClock() { this.accumulator = 0; this.lastTick.set(this.positions); this.renderPositions.set(this.positions); }

  private updateNormals() {
    const n = this.normals, p = this.positions, t = this.topology.triangles;
    n.fill(0);
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const x = p[b] - p[a], y = p[b + 1] - p[a + 1], z = p[b + 2] - p[a + 2];
      const xx = p[c] - p[a], yy = p[c + 1] - p[a + 1], zz = p[c + 2] - p[a + 2];
      const nx = y * zz - z * yy, ny = z * xx - x * zz, nz = x * yy - y * xx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
      n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
      n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (const i of this.topology.active) {
      const j = i * 3, length = Math.hypot(n[j], n[j + 1], n[j + 2]);
      if (length > 1e-9) { n[j] /= length; n[j + 1] /= length; n[j + 2] /= length; }
      else n[j + 2] = 1;
    }
  }

  private solveStretch() {
    const { edges, lengths, inverseMass } = this.topology, p = this.positions;
    const alpha = 0.00000008 / (FIXED_STEP * FIXED_STEP);
    this.reverseStretch = !this.reverseStretch;
    for (let edge = 0; edge < lengths.length; edge++) {
      const i = this.reverseStretch ? lengths.length - 1 - edge : edge;
      const a = edges[i * 2], b = edges[i * 2 + 1], a3 = a * 3, b3 = b * 3;
      const wa = inverseMass[a], wb = inverseMass[b];
      if (wa + wb === 0) continue;
      const x = p[b3] - p[a3], y = p[b3 + 1] - p[a3 + 1], z = p[b3 + 2] - p[a3 + 2];
      const length = Math.sqrt(x * x + y * y + z * z);
      if (length < 1e-10) continue;
      const lambda = (-(length - lengths[i]) - alpha * this.stretchLambda[i]) / (wa + wb + alpha);
      this.stretchLambda[i] += lambda;
      const correction = lambda / length;
      p[a3] -= wa * x * correction; p[a3 + 1] -= wa * y * correction; p[a3 + 2] -= wa * z * correction;
      p[b3] += wb * x * correction; p[b3 + 1] += wb * y * correction; p[b3 + 2] += wb * z * correction;
    }
  }

  private solveTethers() {
    const { active, inverseMass, tetherAnchors, tetherLengths } = this.topology, p = this.positions;
    for (const id of active) {
      const anchor = tetherAnchors[id];
      if (!inverseMass[id] || anchor === 65535) continue;
      const j = id * 3, a = anchor * 3;
      const x = p[j] - this.rest[a], y = p[j + 1] - this.rest[a + 1], z = p[j + 2] - this.rest[a + 2];
      const length = Math.hypot(x, y, z), maximum = tetherLengths[id] * 1.03;
      if (length <= maximum) continue;
      const scale = maximum / length;
      p[j] = this.rest[a] + x * scale; p[j + 1] = this.rest[a + 1] + y * scale; p[j + 2] = this.rest[a + 2] + z * scale;
    }
  }

  private restoreInvalidState() {
    for (const value of this.positions) if (!Number.isFinite(value) || Math.abs(value) > 20) {
      this.positions.set(this.safePositions); this.previous.set(this.safePositions); this.lastTick.set(this.safePositions);
      this.velocities.fill(0); this.releaseGrab(); this.contactCount = 0; this.updateNormals();
      return true;
    }
    return false;
  }

  private solveBending() {
    const { bends, bendWeights: k, bendFactors: factors, inverseMass: mass } = this.topology, p = this.positions;
    const alpha = this.bendCompliance / (FIXED_STEP * FIXED_STEP);
    for (let b = 0; b < factors.length; b++) {
      const offset = b * 4;
      let x = 0, y = 0, z = 0, denominator = 0;
      for (let j = 0; j < 4; j++) {
        const id = bends[offset + j], weight = k[offset + j];
        x += p[id * 3] * weight; y += p[id * 3 + 1] * weight; z += p[id * 3 + 2] * weight;
        denominator += mass[id] * weight * weight;
      }
      const squared = x * x + y * y + z * z, factor = factors[b];
      denominator = denominator * squared * factor * factor + alpha;
      const lambda = (-0.5 * factor * squared - alpha * this.bendLambda[b]) / denominator;
      this.bendLambda[b] += lambda;
      for (let j = 0; j < 4; j++) {
        const id = bends[offset + j], correction = mass[id] * k[offset + j] * factor * lambda;
        p[id * 3] += x * correction; p[id * 3 + 1] += y * correction; p[id * 3 + 2] += z * correction;
      }
    }
  }

  private solveAnchorsAndGrab() {
    const p = this.positions, mass = this.topology.inverseMass;
    for (const pin of this.softPins) if (mass[pin.index] > 0) {
      const j = pin.index * 3, response = 0.12 * pin.strength;
      for (let axis = 0; axis < 3; axis++) p[j + axis] += (this.rest[j + axis] - p[j + axis]) * response;
    }
    const grab = this.grab;
    if (!grab) return;
    const response = 0.28 - this.grabSettings.resistance * 0.2;
    for (let i = 0; i < grab.indices.length; i++) {
      const j = grab.indices[i] * 3;
      const weight = grab.weights[i] * response;
      const dx = grab.target[0] + grab.offsets[i * 3] - p[j];
      const dy = grab.target[1] + grab.offsets[i * 3 + 1] - p[j + 1];
      const dz = grab.target[2] + grab.offsets[i * 3 + 2] - p[j + 2];
      const scale = Math.min(weight, 0.012 / Math.max(Math.hypot(dx, dy, dz), 1e-9));
      p[j] += dx * scale; p[j + 1] += dy * scale; p[j + 2] += dz * scale;
    }
  }

  private fillBounds(ids: Uint16Array, stride: number, output: Float32Array) {
    // Edge boxes are expanded on both sides of a query, unlike point/face.
    const p = this.positions, old = this.previous, margin = (this.thickness + 0.005) * (stride === 2 ? 0.5 : 1);
    for (let i = 0; i < ids.length / stride; i++) {
      const offset = i * 6;
      for (let axis = 0; axis < 3; axis++) {
        let min = Infinity, max = -Infinity;
        for (let j = 0; j < stride; j++) {
          const id = ids[i * stride + j] * 3 + axis;
          min = Math.min(min, p[id], old[id]); max = Math.max(max, p[id], old[id]);
        }
        output[offset + axis] = min - margin; output[offset + 3 + axis] = max + margin;
      }
    }
  }

  private detectContacts() {
    const { triangles, edges, active, adjacent } = this.topology, p = this.positions, old = this.previous;
    const f = this.faceBounds, e = this.edgeBounds, ids = this.ids;
    this.contactCount = 0; this.faceHash.clear(); this.edgeHash.clear();
    this.fillBounds(triangles, 3, f); this.fillBounds(edges, 2, e);
    for (let i = 0; i < triangles.length / 3; i++) this.faceHash.insert(i, f, i * 6);
    for (const a of active) {
      const j = a * 3;
      const minX = Math.min(p[j], old[j]), minY = Math.min(p[j + 1], old[j + 1]), minZ = Math.min(p[j + 2], old[j + 2]);
      const maxX = Math.max(p[j], old[j]), maxY = Math.max(p[j + 1], old[j + 1]), maxZ = Math.max(p[j + 2], old[j + 2]);
      const candidates = this.faceHash.query(minX, minY, minZ, maxX, maxY, maxZ);
      for (const t of candidates) {
        const b = t * 6;
        if (maxX < f[b] || minX > f[b + 3] || maxY < f[b + 1] || minY > f[b + 4] || maxZ < f[b + 2] || minZ > f[b + 5]) continue;
        const i = t * 3, b0 = triangles[i], b1 = triangles[i + 1], b2 = triangles[i + 2];
        if (adjacent[a].has(b0) || adjacent[a].has(b1) || adjacent[a].has(b2)) continue;
        ids[0] = a; ids[1] = b0; ids[2] = b1; ids[3] = b2;
        const contact = this.contacts[this.contactCount] ?? (this.contacts[this.contactCount] = createContact());
        if (vertexFaceContact(p, old, ids, this.thickness, contact)) { this.contactCorrections[this.contactCount] = 0; this.contactCount++; }
      }
    }
    for (let i = 0; i < edges.length / 2; i++) {
      const b = i * 6, a0 = edges[i * 2], a1 = edges[i * 2 + 1];
      const candidates = this.edgeHash.query(e[b], e[b + 1], e[b + 2], e[b + 3], e[b + 4], e[b + 5]);
      for (const other of candidates) {
        const o = other * 6;
        if (e[b + 3] < e[o] || e[b] > e[o + 3] || e[b + 4] < e[o + 1] || e[b + 1] > e[o + 4] || e[b + 5] < e[o + 2] || e[b + 2] > e[o + 5]) continue;
        const b0 = edges[other * 2], b1 = edges[other * 2 + 1];
        if (adjacent[a0].has(b0) || adjacent[a0].has(b1) || adjacent[a1].has(b0) || adjacent[a1].has(b1)) continue;
        ids[0] = a0; ids[1] = a1; ids[2] = b0; ids[3] = b1;
        const contact = this.contacts[this.contactCount] ?? (this.contacts[this.contactCount] = createContact());
        if (edgeEdgeContact(p, old, ids, this.thickness, contact)) { this.contactCorrections[this.contactCount] = 0; this.contactCount++; }
      }
      this.edgeHash.insert(i, e, b);
    }
  }

  private solveContacts() {
    const p = this.positions, mass = this.topology.inverseMass;
    for (let i = 0; i < this.contactCount; i++) {
      const c = this.contacts[i];
      let separation = 0, denominator = 0;
      for (let j = 0; j < 4; j++) {
        const id = c.ids[j], w = c.weights[j];
        separation += w * (p[id * 3] * c.nx + p[id * 3 + 1] * c.ny + p[id * 3 + 2] * c.nz);
        denominator += mass[id] * w * w;
      }
      if (separation >= this.thickness || denominator < 1e-9) continue;
      const correction = Math.min(this.thickness - separation, 0.04) / denominator;
      this.contactCorrections[i] += correction;
      for (let j = 0; j < 4; j++) {
        const id = c.ids[j], delta = correction * mass[id] * c.weights[j];
        p[id * 3] += delta * c.nx; p[id * 3 + 1] += delta * c.ny; p[id * 3 + 2] += delta * c.nz;
      }
    }
  }

  private contactVelocities() {
    const v = this.velocities, mass = this.topology.inverseMass;
    for (let i = 0; i < this.contactCount; i++) {
      const c = this.contacts[i];
      let x = 0, y = 0, z = 0, denominator = 0;
      for (let j = 0; j < 4; j++) {
        const id = c.ids[j], w = c.weights[j];
        x += v[id * 3] * w; y += v[id * 3 + 1] * w; z += v[id * 3 + 2] * w;
        denominator += mass[id] * w * w;
      }
      if (denominator < 1e-9) continue;
      const vn = x * c.nx + y * c.ny + z * c.nz;
      const tx = x - vn * c.nx, ty = y - vn * c.ny, tz = z - vn * c.nz;
      const friction = Math.min(1, 0.16 * (Math.max(-vn, 0) + this.contactCorrections[i] / FIXED_STEP) / Math.max(Math.hypot(tx, ty, tz), 1e-9));
      for (let j = 0; j < 4; j++) {
        const id = c.ids[j], scale = mass[id] * c.weights[j] / denominator;
        v[id * 3] -= scale * (Math.min(vn, 0) * c.nx + friction * tx);
        v[id * 3 + 1] -= scale * (Math.min(vn, 0) * c.ny + friction * ty);
        v[id * 3 + 2] -= scale * (Math.min(vn, 0) * c.nz + friction * tz);
      }
    }
  }

  private tick(wind: WindControls, gust: number) {
    const start = performance.now(), p = this.positions, v = this.velocities, n = this.normals;
    const { active, inverseMass } = this.topology, top = this.layout.anchor === "top", h = FIXED_STEP;
    if (this.restoreInvalidState()) return true;
    this.lastTick.set(p); this.previous.set(p);
    this.time += h * clamp(wind.speed, 0.01, 300);
    const envelope = clamp(1 + (Math.sin(this.time * 0.38 + 0.6) * 0.52 + Math.sin(this.time * 0.91 + 2.1) * 0.3 + Math.sin(this.time * 1.83 + 4.2) * 0.18) * wind.gustiness * 0.55, 0.22, 1.75);
    const strength = Math.max(0, (wind.strength + gust * 1.35) * envelope);
    const load = Math.min(1 - Math.exp(-strength * 0.82) + Math.log1p(Math.max(strength - 1, 0)) * 0.48, 3.2);
    const damping = Math.exp(-2.9 * h);
    for (const id of active) {
      if (!inverseMass[id]) continue;
      const j = id * 3, u = id % (this.columns + 1) / this.columns, row = Math.floor(id / (this.columns + 1)) / this.rows;
      const distance = top ? row : u;
      const flutter = Math.sin(this.time * 5.2 + row * 17 + u * 9) * 0.62 + Math.sin(this.time * 8.7 - row * 23 + u * 15) * 0.38;
      const wake = Math.sin(this.time * 2.1 + (top ? u : row) * 8.4) * distance ** 2.4;
      const turbulence = load * (wind.turbulence + gust * 1.8) * (flutter * 0.62 + wake * 0.38) * distance;
      // Pressure follows the current surface normal and opposes relative flow.
      const flowX = top ? turbulence * 0.06 : load * 4;
      const flowZ = top ? load * 1.5 + turbulence * 0.3 : turbulence * 0.8;
      const normalFlow = (flowX - v[j]) * n[j] - v[j + 1] * n[j + 1] + (flowZ - v[j + 2]) * n[j + 2];
      const pressure = clamp(normalFlow * Math.abs(normalFlow) * 0.32, -14, 14);
      const fx = (top ? turbulence * 0.03 : load * (7.4 + distance * 2.4)) + n[j] * pressure;
      const fy = -wind.gravity * 3.15 + wind.direction * load * (top ? 0.34 : 2.4) + n[j + 1] * pressure;
      const fz = (top ? load * (0.48 + distance * 0.38) + turbulence * 0.18 : turbulence * 0.65) + n[j + 2] * pressure;
      v[j] = (v[j] + fx * h) * damping; v[j + 1] = (v[j + 1] + fy * h) * damping; v[j + 2] = (v[j + 2] + fz * h) * damping;
      const limit = Math.min(1, 3.6 / Math.max(Math.hypot(v[j], v[j + 1], v[j + 2]), 1e-9));
      p[j] += v[j] * h * limit; p[j + 1] += v[j + 1] * h * limit; p[j + 2] += v[j + 2] * h * limit;
    }
    let released = false;
    if (this.grab) {
      const g = this.grab;
      const dx = g.requested[0] - g.target[0], dy = g.requested[1] - g.target[1], dz = g.requested[2] - g.target[2];
      const distance = Math.hypot(dx, dy, dz), response = Math.min(1 - Math.exp(-24 * h), 0.025 / Math.max(distance, 1e-9));
      g.target[0] += dx * response; g.target[1] += dy * response; g.target[2] += dz * response;
      // Only an extreme, sustained out-of-bounds gesture uses the fail-safe.
      g.stressTime = distance > Math.max(this.layout.width, this.layout.height) * 2 ? g.stressTime + h : 0;
      if (g.stressTime > 0.75) { this.releaseGrab(); released = true; }
    }
    const integrated = performance.now(); this.timings.integrate += integrated - start;
    this.stretchLambda.fill(0); this.bendLambda.fill(0);
    this.solveAnchorsAndGrab(); this.solveTethers(); this.solveStretch(); this.solveBending(); this.solveStretch();
    // Guard before building spatial bounds; a corrupt coordinate must never grow
    // a hash query into millions of cells or poison subsequent frames.
    if (this.restoreInvalidState()) return true;
    const preSolved = performance.now(); this.timings.constraints += preSolved - integrated;
    this.detectContacts();
    const detected = performance.now(); this.timings.contacts += detected - preSolved;
    for (let i = 0; i < this.iterations; i++) {
      this.solveAnchorsAndGrab(); this.solveTethers(); this.solveStretch(); this.solveBending(); this.solveContacts();
    }
    this.solveTethers(); this.solveStretch(); this.solveContacts();
    const solved = performance.now(); this.timings.constraints += solved - detected;
    // Recheck changed trajectories at contact-heavy folds before the final projection.
    if (this.contactCount > 0) { this.detectContacts(); this.solveContacts(); this.solveStretch(); this.solveContacts(); }
    this.timings.contacts += performance.now() - solved;
    let motion = 0;
    let finite = true;
    for (const id of active) {
      const j = id * 3;
      if (!inverseMass[id]) {
        for (let axis = 0; axis < 3; axis++) { p[j + axis] = this.rest[j + axis]; v[j + axis] = 0; }
      } else {
        for (let axis = 0; axis < 3; axis++) {
          const value = p[j + axis];
          if (!Number.isFinite(value) || Math.abs(value) > 20) finite = false;
          v[j + axis] = clamp((value - this.previous[j + axis]) / h, -4, 4);
        }
        if (this.audioEnabled) motion += Math.abs(v[j + 2]);
      }
    }
    if (!finite) {
      p.set(this.safePositions); v.fill(0); this.releaseGrab(); released = true;
    } else this.safePositions.set(p);
    this.contactVelocities();
    if (this.audioEnabled) {
      const nextMotion = 1 - Math.exp(-motion / active.length * 0.42);
      this.impact = clamp(Math.abs(nextMotion - this.motion) * 3 + this.contactCount * 0.001, 0, 1);
      this.motion = nextMotion;
    }
    const beforeNormals = performance.now(); this.updateNormals(); this.timings.normals += performance.now() - beforeNormals;
    this.timings.contactsCount = Math.max(this.timings.contactsCount, this.contactCount);
    return released;
  }

  step(delta: number, wind: WindControls, transitionGust = 0) {
    const start = performance.now();
    this.timings.integrate = this.timings.constraints = this.timings.contacts = this.timings.normals = this.timings.steps = this.timings.contactsCount = this.timings.droppedTime = 0;
    if (!(delta > 0) || !Number.isFinite(delta)) { this.timings.total = 0; return { motion: this.motion, impact: 0, releasedGrab: false, updated: false }; }
    const accepted = Math.min(delta, MAX_STEPS * FIXED_STEP);
    this.timings.droppedTime = delta - accepted;
    this.accumulator += accepted;
    let releasedGrab = false;
    while (this.accumulator + 1e-10 >= FIXED_STEP && this.timings.steps < MAX_STEPS) {
      releasedGrab = this.tick(wind, transitionGust) || releasedGrab;
      this.accumulator -= FIXED_STEP; this.timings.steps++;
    }
    this.accumulator = Math.max(0, this.accumulator);
    const alpha = this.accumulator / FIXED_STEP;
    for (let i = 0; i < this.positions.length; i++) this.renderPositions[i] = this.lastTick[i] * (1 - alpha) + this.positions[i] * alpha;
    this.timings.total = performance.now() - start;
    return { motion: this.audioEnabled ? this.motion : 0, impact: this.audioEnabled ? this.impact : 0, releasedGrab, updated: true };
  }

  beginGrab(u: number, v: number, x: number, y: number, z: number) {
    if (![u, v, x, y, z].every(Number.isFinite)) return false;
    const grab: Grab = { indices: [], weights: [], offsets: [], target: [x, y, z], requested: [x, y, z], stressTime: 0 };
    for (const i of this.topology.active) {
      if (!this.topology.inverseMass[i]) continue;
      const du = (i % (this.columns + 1) / this.columns - u) * this.layout.width / this.layout.height;
      const dv = 1 - Math.floor(i / (this.columns + 1)) / this.rows - v;
      const distance = Math.hypot(du, dv);
      if (distance >= this.grabSettings.radius) continue;
      grab.indices.push(i); grab.weights.push(Math.cos(distance / this.grabSettings.radius * Math.PI * 0.5) ** 2);
      grab.offsets.push(this.positions[i * 3] - x, this.positions[i * 3 + 1] - y, this.positions[i * 3 + 2] - z);
    }
    if (!grab.indices.length) return false;
    this.grab = grab; return true;
  }
  moveGrab(x: number, y: number, z: number) { if (this.grab && [x, y, z].every(Number.isFinite)) this.grab.requested = [x, y, z]; }
  releaseGrab() {
    if (this.grab) for (let i = 0; i < this.grab.indices.length; i++) {
      const j = this.grab.indices[i] * 3, retention = 0.15 + this.grabSettings.inertia * 0.85;
      this.velocities[j] *= retention; this.velocities[j + 1] *= retention; this.velocities[j + 2] *= retention;
    }
    this.grab = null;
  }
  poke(u: number, v: number) {
    for (const i of this.topology.active) if (this.topology.inverseMass[i]) {
      const du = (i % (this.columns + 1) / this.columns - u) * this.layout.width / this.layout.height;
      const dv = 1 - Math.floor(i / (this.columns + 1)) / this.rows - v;
      const distance = Math.hypot(du, dv);
      if (distance < 0.22) this.velocities[i * 3 + 2] -= Math.cos(distance / 0.22 * Math.PI * 0.5) ** 2 * 1.2;
    }
  }
}
