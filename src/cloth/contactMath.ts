import { Triangle, Vector3 } from "three";

// Scratch storage is reused. These functions run synchronously on one solver thread.
const points = Array.from({ length: 4 }, () => new Vector3());
const oldPoints = Array.from({ length: 4 }, () => new Vector3());
const interpolated = Array.from({ length: 4 }, () => new Vector3());
const ab = new Vector3(), ac = new Vector3(), ap = new Vector3();
const closest = new Vector3(), bary = new Vector3(), normal = new Vector3();
const triangle = new Triangle();
const breaks = new Float64Array(4);
const roots = new Float64Array(4);

export type Contact = {
  ids: [number, number, number, number];
  weights: [number, number, number, number];
  nx: number; ny: number; nz: number;
  swept: boolean;
};

export function createContact(): Contact {
  return { ids: [0, 0, 0, 0], weights: [0, 0, 0, 0], nx: 0, ny: 0, nz: 1, swept: false };
}

function load(p: Float32Array, previous: Float32Array, ids: readonly number[]) {
  for (let j = 0; j < 4; j++) {
    points[j].fromArray(p, ids[j] * 3);
    oldPoints[j].fromArray(previous, ids[j] * 3);
  }
}

function at(t: number) {
  for (let j = 0; j < 4; j++) interpolated[j].lerpVectors(oldPoints[j], points[j], t);
}

function volume(t: number) {
  at(t);
  ab.subVectors(interpolated[1], interpolated[0]);
  ac.subVectors(interpolated[2], interpolated[0]);
  ap.subVectors(interpolated[3], interpolated[0]);
  return ab.cross(ac).dot(ap);
}

// Coplanarity of four linearly moving vertices is cubic. Split at derivative
// roots before bisection so a crossing-and-return is not missed by endpoint signs.
function crossingTimes() {
  const f0 = volume(0), f1 = volume(1 / 3), f2 = volume(2 / 3), f3 = volume(1);
  const a = 4.5 * (f3 - 3 * f2 + 3 * f1 - f0);
  const b = 4.5 * (f2 - 2 * f1 + f0) - a;
  const c = 3 * (f1 - f0) - a / 9 - b / 3;
  const value = (t: number) => ((a * t + b) * t + c) * t + f0;
  let n = 1;
  breaks[0] = 0;
  if (Math.abs(a) > 1e-12) {
    const discriminant = b * b - 3 * a * c;
    if (discriminant > 0) {
      const r = Math.sqrt(discriminant);
      const r1 = (-b - r) / (3 * a), r2 = (-b + r) / (3 * a);
      if (r1 > 0 && r1 < 1) breaks[n++] = r1;
      if (r2 > 0 && r2 < 1) breaks[n++] = r2;
    }
  } else if (Math.abs(b) > 1e-12) {
    const r = -c / (2 * b);
    if (r > 0 && r < 1) breaks[n++] = r;
  }
  breaks[n++] = 1;
  // At most four elements; don't allocate a sorted copy for every candidate.
  for (let i = 1; i < n; i++) for (let j = i; j > 0 && breaks[j] < breaks[j - 1]; j--) {
    const tmp = breaks[j]; breaks[j] = breaks[j - 1]; breaks[j - 1] = tmp;
  }
  let count = 0;
  if (Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(f0) < 1e-12) return 0;
  for (let j = 0; j < n - 1; j++) {
    let lo = breaks[j], hi = breaks[j + 1], vlo = value(lo);
    const vhi = value(hi);
    if (Math.abs(vlo) < 1e-10 && lo > 1e-6) roots[count++] = lo;
    if (vlo * vhi < 0) {
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) * 0.5, vmid = value(mid);
        if (vlo * vmid <= 0) hi = mid;
        else { lo = mid; vlo = vmid; }
      }
      roots[count++] = (lo + hi) * 0.5;
    }
  }
  return count;
}

function store(out: Contact, ids: readonly number[], weights: readonly number[], swept: boolean) {
  for (let j = 0; j < 4; j++) { out.ids[j] = ids[j]; out.weights[j] = weights[j]; }
  out.nx = normal.x; out.ny = normal.y; out.nz = normal.z; out.swept = swept;
}

const vfWeights = [1, 0, 0, 0];
export function vertexFaceContact(
  p: Float32Array, previous: Float32Array, ids: readonly number[], thickness: number, out: Contact,
) {
  load(p, previous, ids);
  const test = (q: Vector3[], swept: boolean) => {
    triangle.set(q[1], q[2], q[3]);
    triangle.getNormal(normal);
    if (normal.lengthSq() < 0.5) return false;
    triangle.closestPointToPoint(q[0], closest);
    const distanceSq = closest.distanceToSquared(q[0]);
    if (distanceSq > (swept ? 1e-9 : thickness * thickness)) return false;
    triangle.getBarycoord(closest, bary);
    vfWeights[1] = -bary.x; vfWeights[2] = -bary.y; vfWeights[3] = -bary.z;
    ap.copy(oldPoints[0]);
    for (let j = 1; j < 4; j++) ap.addScaledVector(oldPoints[j], vfWeights[j]);
    if (ap.dot(normal) < 0) normal.negate();
    if (!swept && distanceSq > 1e-12) {
      ac.subVectors(q[0], closest).normalize();
      // Preserve the previous side even if the point has already crossed.
      if (ac.dot(normal) > 0) normal.copy(ac);
    }
    store(out, ids, vfWeights, swept);
    return true;
  };
  // A full crossing can finish outside the contact shell. Check its trajectory.
  const count = crossingTimes();
  for (let i = 0; i < count; i++) { at(roots[i]); if (test(interpolated, true)) return true; }
  return test(points, false);
}

const u = new Vector3(), v = new Vector3(), w = new Vector3();
let edgeS = 0, edgeT = 0;
function closestEdges(q: Vector3[]) {
  u.subVectors(q[1], q[0]); v.subVectors(q[3], q[2]); w.subVectors(q[0], q[2]);
  const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w), e = v.dot(w);
  const denominator = a * c - b * b;
  edgeS = denominator > 1e-12 ? Math.max(0, Math.min(1, (b * e - c * d) / denominator)) : 0;
  edgeT = c > 1e-12 ? (b * edgeS + e) / c : 0;
  if (edgeT < 0) { edgeT = 0; edgeS = a > 1e-12 ? Math.max(0, Math.min(1, -d / a)) : 0; }
  else if (edgeT > 1) { edgeT = 1; edgeS = a > 1e-12 ? Math.max(0, Math.min(1, (b - d) / a)) : 0; }
  closest.copy(q[0]).addScaledVector(u, edgeS);
  ap.copy(q[2]).addScaledVector(v, edgeT);
  normal.subVectors(closest, ap);
  return normal.lengthSq();
}

const eeWeights = [0, 0, 0, 0];
export function edgeEdgeContact(
  p: Float32Array, previous: Float32Array, ids: readonly number[], thickness: number, out: Contact,
) {
  load(p, previous, ids);
  const test = (q: Vector3[], swept: boolean) => {
    const distanceSq = closestEdges(q);
    if (distanceSq > (swept ? 1e-9 : thickness * thickness)) return false;
    eeWeights[0] = 1 - edgeS; eeWeights[1] = edgeS;
    eeWeights[2] = edgeT - 1; eeWeights[3] = -edgeT;
    ap.set(0, 0, 0);
    for (let j = 0; j < 4; j++) ap.addScaledVector(oldPoints[j], eeWeights[j]);
    if (distanceSq < 1e-12) {
      normal.crossVectors(u, v);
      if (normal.lengthSq() < 1e-12) normal.copy(ap);
      if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
    }
    normal.normalize();
    if (normal.dot(ap) < 0) normal.negate();
    store(out, ids, eeWeights, swept);
    return true;
  };
  const count = crossingTimes();
  for (let i = 0; i < count; i++) { at(roots[i]); if (test(interpolated, true)) return true; }
  return test(points, false);
}
