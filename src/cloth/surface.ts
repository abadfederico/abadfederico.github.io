import * as THREE from "three";
import type { ClothLayout, MeshQuality } from "../studio/config";
import { createClothIndex } from "./topology";

const RESOLUTIONS = {
  1: { desktop: [24, 14], mobile: [12, 25] },
  2: { desktop: [28, 16], mobile: [14, 29] },
  3: { desktop: [32, 18], mobile: [16, 34] },
  4: { desktop: [44, 26], mobile: [22, 46] },
} as const;

export function physicsResolution(quality: MeshQuality, portrait: boolean) {
  const [columns, rows] = RESOLUTIONS[quality][portrait ? "mobile" : "desktop"];
  return { columns, rows };
}

export function createClothSurface(layout: ClothLayout, columns: number, rows: number, subdivisions = 3) {
  const physical = new THREE.PlaneGeometry(layout.width, layout.height, columns, rows);
  const pointed = layout.anchor === "top" ? columns / (2 * rows) : 0;
  const intact = createClothIndex(physical, columns, rows, layout.anchor, pointed, false);
  const torn = createClothIndex(physical, columns, rows, layout.anchor, pointed, true);
  const all = createClothIndex(physical, columns, rows, layout.anchor, 0, false);
  // The left half of a pennant uses the other diagonal. Use its intact topology
  // plus a full grid with the same orientation to make one shared interpolation map.
  if (pointed) {
    const uv = physical.getAttribute("uv");
    for (let t = 0; t < all.count; t += 6) {
      const a = all.getX(t), b = all.getX(t + 1), c = all.getX(t + 2), d = all.getX(t + 4);
      if (uv.getX(a) < 0.5) { all.setX(t, a); all.setX(t + 1, d); all.setX(t + 2, c); all.setX(t + 3, a); all.setX(t + 4, b); all.setX(t + 5, d); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const width = columns * subdivisions + 1;
  const count = width * (rows * subdivisions + 1);
  const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const sources = new Uint16Array(count * 3), weights = new Float32Array(count * 3);
  const refined = new Map<string, number[]>();
  const uv = physical.getAttribute("uv");
  const physicalPositions = physical.getAttribute("position").array;
  const mapped = new Uint8Array(count);
  const key = (a: number, b: number, c: number) => `${a}:${b}:${c}`;
  for (let t = 0; t < all.count; t += 3) {
    const a = all.getX(t), b = all.getX(t + 1), c = all.getX(t + 2);
    const nodes: number[][] = [];
    for (let i = 0; i <= subdivisions; i++) {
      nodes[i] = [];
      for (let j = 0; j <= subdivisions - i; j++) {
        const wb = i / subdivisions, wc = j / subdivisions, wa = 1 - wb - wc;
        const u = uv.getX(a) * wa + uv.getX(b) * wb + uv.getX(c) * wc;
        const v = uv.getY(a) * wa + uv.getY(b) * wb + uv.getY(c) * wc;
        const id = Math.round(u * columns * subdivisions) + Math.round((1 - v) * rows * subdivisions) * width;
        nodes[i][j] = id;
        if (!mapped[id]) {
          mapped[id] = 1;
          sources.set([a, b, c], id * 3); weights.set([wa, wb, wc], id * 3); uvs.set([u, v], id * 2);
          for (let axis = 0; axis < 3; axis++) positions[id * 3 + axis] = physicalPositions[a * 3 + axis] * wa + physicalPositions[b * 3 + axis] * wb + physicalPositions[c * 3 + axis] * wc;
        }
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < subdivisions; i++) for (let j = 0; j < subdivisions - i; j++) {
      indices.push(nodes[i][j], nodes[i + 1][j], nodes[i][j + 1]);
      if (j < subdivisions - i - 1) indices.push(nodes[i + 1][j], nodes[i + 1][j + 1], nodes[i][j + 1]);
    }
    refined.set(key(a, b, c), indices);
  }
  const refine = (topology: THREE.BufferAttribute) => {
    const indices: number[] = [];
    for (let i = 0; i < topology.count; i += 3) {
      const children = refined.get(key(topology.getX(i), topology.getX(i + 1), topology.getX(i + 2)));
      if (!children) throw new Error("La topología visual no coincide con la física");
      indices.push(...children);
    }
    return new THREE.BufferAttribute(new Uint16Array(indices), 1);
  };
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const intactIndex = refine(intact), tornIndex = refine(torn);
  geometry.setIndex(intactIndex); geometry.computeVertexNormals();
  const update = (p: Float32Array, normals: Float32Array) => {
    const visualNormals = geometry.getAttribute("normal").array as Float32Array;
    for (let i = 0; i < count * 3; i += 3) {
      const a = sources[i] * 3, b = sources[i + 1] * 3, c = sources[i + 2] * 3;
      const wa = weights[i], wb = weights[i + 1], wc = weights[i + 2];
      for (let axis = 0; axis < 3; axis++) {
        positions[i + axis] = p[a + axis] * wa + p[b + axis] * wb + p[c + axis] * wc;
        visualNormals[i + axis] = normals[a + axis] * wa + normals[b + axis] * wb + normals[c + axis] * wc;
      }
      const length = Math.hypot(visualNormals[i], visualNormals[i + 1], visualNormals[i + 2]);
      if (length > 1e-9) for (let axis = 0; axis < 3; axis++) visualNormals[i + axis] /= length;
    }
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("normal").needsUpdate = true;
  };
  return { physical, geometry, intact, torn, intactIndex, tornIndex, update };
}
