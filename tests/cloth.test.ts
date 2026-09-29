import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClothSimulation, FIXED_STEP } from '../src/cloth/simulation';
import { createClothSurface, physicsResolution } from '../src/cloth/surface';
import { INITIAL_WIND, LANDSCAPE_CLOTH, PORTRAIT_CLOTH } from '../src/studio/config';
import { createContact, vertexFaceContact, edgeEdgeContact } from '../src/cloth/contactMath';
import { SpatialHash } from '../src/cloth/spatialHash';

export function make(portrait = false, quality: 1 | 2 | 3 | 4 = 3) {
  const layout = portrait ? PORTRAIT_CLOTH : LANDSCAPE_CLOTH;
  const { columns, rows } = physicsResolution(quality, portrait);
  const surface = createClothSurface(layout, columns, rows);
  const sim = new ClothSimulation(surface.physical.getAttribute('position').array as Float32Array, columns, rows, layout, surface.intact.array as Uint16Array, surface.torn.array as Uint16Array);
  return { sim, surface, columns, rows };
}

test('zero/invalid delta does not move particles or advance the clock; catch-up is bounded', () => {
  const { sim } = make();
  sim.step(1 / 60, INITIAL_WIND);
  const before = sim.positions.slice(), time = sim.simulationTime;
  for (const dt of [0, -1, NaN, Infinity]) sim.step(dt, INITIAL_WIND);
  assert.deepEqual(sim.positions, before); assert.equal(sim.simulationTime, time);
  sim.step(10, INITIAL_WIND);
  assert.equal(sim.timings.steps, 6); assert.ok(sim.timings.droppedTime > 9);
});

test('30, 60, 120 Hz and irregular frames produce the same physical state', () => {
  const run = (deltas: number[]) => {
    const { sim } = make(false, 1);
    for (const dt of deltas) sim.step(dt, INITIAL_WIND);
    return sim.positions;
  };
  const reference = run(Array(120).fill(1 / 60));
  for (const deltas of [Array(60).fill(1 / 30), Array(240).fill(1 / 120), Array.from({ length: 120 }, (_, i) => i % 2 ? 1 / 40 : 1 / 120)]) {
    const p = run(deltas);
    let error = 0; for (let i = 0; i < p.length; i++) error = Math.max(error, Math.abs(p[i] - reference[i]));
    assert.ok(error < 1e-6, `frame-dependent error ${error}`);
  }
});

test('pennant and tears have no constraints or motion on invisible vertices', () => {
  for (const portrait of [false, true]) {
    const { sim, surface } = make(portrait);
    for (const torn of [false, true]) {
      sim.setTorn(torn); sim.reset();
      const used = new Set(sim.triangles);
      assert.equal(sim.activeCount, used.size);
      for (const id of sim.edges) assert.ok(used.has(id));
      for (let i = 0; i < 20; i++) sim.step(1 / 60, INITIAL_WIND);
      for (let i = 0; i < sim.positions.length / 3; i++) {
        if (!used.has(i) || sim.pinned[i]) {
          for (let j = 0; j < 3; j++) assert.equal(sim.positions[i * 3 + j], sim.rest[i * 3 + j]);
        }
      }
      surface.geometry.setIndex(torn ? surface.tornIndex : surface.intactIndex);
      surface.update(sim.renderPositions, sim.normals);
      for (const value of surface.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
      assert.equal(surface.geometry.index!.count, sim.triangles.length * 9);
    }
  }
});

test('mobile has a smaller active physical budget at every quality', () => {
  for (const q of [1, 2, 3, 4] as const) assert.ok(make(true, q).sim.activeCount < make(false, q).sim.activeCount);
});

test('swept vertex/face detects a full crossing outside the final thickness shell', () => {
  const before = new Float32Array([0, 0, 1, -1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const after = before.slice(); after[2] = -1;
  const c = createContact();
  assert.ok(vertexFaceContact(after, before, [0, 1, 2, 3], .01, c));
  assert.equal(c.swept, true); assert.ok(c.nz > .99);
  assert.ok(Math.abs(c.weights.reduce((a, b) => a + b, 0)) < 1e-6);
  after[0] = 4; before[0] = 4;
  assert.equal(vertexFaceContact(after, before, [0, 1, 2, 3], .01, c), false);
});

test('swept edge/edge detects crossing and proximity excludes a far pair', () => {
  const before = new Float32Array([-1, 0, 0, 1, 0, 0, 0, -1, 1, 0, 1, 1]);
  const after = before.slice(); after[8] = after[11] = -1;
  const c = createContact();
  assert.ok(edgeEdgeContact(after, before, [0, 1, 2, 3], .01, c));
  assert.equal(c.swept, true);
  after[6] = before[6] = 3; after[9] = before[9] = 3;
  assert.equal(edgeEdgeContact(after, before, [0, 1, 2, 3], .01, c), false);
});

test('spatial query covers the entire warning/swept box across multiple cells', () => {
  const hash = new SpatialHash(.06, 1);
  hash.insert(0, new Float32Array([.1205, 0, 0, .121, .001, .001]), 0);
  assert.deepEqual(hash.query(.0595 - .081, -.081, -.081, .0595 + .081, .081, .081), [0]);
});

test('rapid drag resists without immediate release; cancellation and pins remain stable', () => {
  const { sim, columns, rows } = make(false, 1);
  const id = Math.floor(rows / 2) * (columns + 1) + Math.floor(columns * .7);
  const j = id * 3, u = Math.floor(columns * .7) / columns, v = 1 - Math.floor(rows / 2) / rows;
  assert.ok(sim.beginGrab(u, v, sim.positions[j], sim.positions[j + 1], sim.positions[j + 2]));
  sim.moveGrab(sim.positions[j] - 2, sim.positions[j + 1] + .5, 0);
  assert.equal(sim.step(FIXED_STEP, INITIAL_WIND).releasedGrab, false);
  for (let i = 0; i < 90; i++) sim.step(1 / 60, INITIAL_WIND);
  for (const value of sim.positions) assert.ok(Number.isFinite(value) && Math.abs(value) < 5);
  for (let i = 0; i < sim.pinned.length; i++) if (sim.pinned[i]) assert.deepEqual(sim.positions.slice(i * 3, i * 3 + 3), sim.rest.slice(i * 3, i * 3 + 3));
  sim.releaseGrab(); assert.equal(sim.isGrabbed, false);
});

test('overlapping disconnected layers separate without hidden tethers across the gap', () => {
  const rest = new Float32Array(12 * 3);
  const lower = [1, 2, 7], upper = [3, 4, 9];
  const shape = [[-.3, -.3, 0], [.3, -.3, 0], [-.3, .3, 0]];
  for (let i = 0; i < 3; i++) {
    rest.set(shape[i], lower[i] * 3);
    rest.set([shape[i][0] + 2, shape[i][1], 0], upper[i] * 3);
  }
  const indices = new Uint16Array([...lower, ...upper]);
  const sim = new ClothSimulation(rest, 5, 1, LANDSCAPE_CLOTH, indices, indices);
  for (let i = 0; i < 3; i++) {
    sim.positions.set(shape[i], lower[i] * 3);
    sim.positions.set([shape[i][0], shape[i][1], .004], upper[i] * 3);
  }
  sim.velocities.fill(0);
  sim.step(FIXED_STEP, { ...INITIAL_WIND, strength: 0, turbulence: 0, gravity: 0 });
  assert.ok(sim.timings.contactsCount > 0);
  const averageZ = (ids: number[]) => ids.reduce((sum, id) => sum + sim.positions[id * 3 + 2], 0) / ids.length;
  assert.ok(averageZ(upper) - averageZ(lower) >= .011, 'layers must preserve their original side and physical thickness');
});

test('strong folds activate surface contacts while anchors and finite bounds hold', () => {
  const { sim, columns, rows } = make();
  for (let i = 0; i < 60; i++) sim.step(1 / 60, INITIAL_WIND);
  const col = Math.floor(columns * .9), row = Math.floor(rows * .5), j = (row * (columns + 1) + col) * 3;
  const origin = [...sim.positions.slice(j, j + 3)];
  assert.ok(sim.beginGrab(col / columns, 1 - row / rows, origin[0], origin[1], origin[2]));
  let contacts = 0, stretch = 1;
  for (let frame = 0; frame < 180; frame++) {
    sim.moveGrab(origin[0] - 2.5 * Math.min(frame / 60, 1), origin[1], origin[2] + .02);
    sim.step(1 / 60, INITIAL_WIND);
    contacts = Math.max(contacts, sim.timings.contactsCount);
    for (let i = 0; i < sim.edges.length; i += 2) {
      const a = sim.edges[i] * 3, b = sim.edges[i + 1] * 3;
      const length = Math.hypot(sim.positions[a] - sim.positions[b], sim.positions[a + 1] - sim.positions[b + 1], sim.positions[a + 2] - sim.positions[b + 2]);
      const rest = Math.hypot(sim.rest[a] - sim.rest[b], sim.rest[a + 1] - sim.rest[b + 1]);
      stretch = Math.max(stretch, length / rest);
    }
  }
  assert.ok(contacts > 0); assert.ok(sim.isGrabbed); assert.ok(stretch < 1.3, `excessive local stretch: ${stretch}`);
  for (const value of sim.positions) assert.ok(Number.isFinite(value) && Math.abs(value) < 5);
  for (let i = 0; i < sim.pinned.length; i++) if (sim.pinned[i]) assert.deepEqual(sim.positions.slice(i * 3, i * 3 + 3), sim.rest.slice(i * 3, i * 3 + 3));
});

test('corrupt coordinates recover before entering the spatial hash', () => {
  const { sim } = make(false, 1);
  const safe = sim.positions.slice();
  for (const invalid of [NaN, Infinity, 1e20]) {
    sim.positions[9] = invalid;
    assert.ok(sim.step(FIXED_STEP, INITIAL_WIND).releasedGrab);
    assert.deepEqual(sim.positions, safe);
  }
});
