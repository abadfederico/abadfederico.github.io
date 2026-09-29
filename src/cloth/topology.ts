import * as THREE from "three";
import type { ClothAnchor } from "../studio/config";

export function distanceToSegment(
  x: number,
  y: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared =
    segmentX * segmentX + segmentY * segmentY;
  const projection = THREE.MathUtils.clamp(
    ((x - startX) * segmentX + (y - startY) * segmentY) /
      segmentLengthSquared,
    0,
    1,
  );
  return Math.hypot(
    x - (startX + segmentX * projection),
    y - (startY + segmentY * projection),
  );
}

export function tearNoise(
  u: number,
  v: number,
  columns: number,
  rows: number,
) {
  const gridX = Math.floor(u * columns);
  const gridY = Math.floor(v * rows);
  return (
    Math.sin(gridX * 12.9898 + gridY * 78.233) * 43758.5453 -
    Math.floor(
      Math.sin(gridX * 12.9898 + gridY * 78.233) * 43758.5453,
    )
  );
}

export function isLandscapeTornArea(
  u: number,
  v: number,
  expansion: number,
  columns: number,
  rows: number,
) {
  const noise = tearNoise(u, v, columns, rows) - 0.5;
  const largeHole =
    ((u - 0.72) / (0.075 + expansion + noise * 0.012)) ** 2 +
      ((v - 0.67) / (0.105 + expansion + noise * 0.015)) ** 2 <
    1;
  const smallHole =
    ((u - 0.36) / (0.045 + expansion + noise * 0.01)) ** 2 +
      ((v - 0.3) / (0.066 + expansion + noise * 0.012)) ** 2 <
    1;
  const mainSlit =
    distanceToSegment(u, v, 0.43, 0.73, 0.58, 0.38) <
    0.014 + expansion + Math.abs(noise) * 0.008;
  const splitSlit =
    distanceToSegment(u, v, 0.52, 0.52, 0.64, 0.43) <
    0.009 + expansion + Math.abs(noise) * 0.006;
  const edgeDistance = Math.abs(v - 0.2);
  const edgeTear =
    edgeDistance < 0.14 + expansion &&
    u >
      0.885 +
        edgeDistance * 0.5 -
        expansion * 1.5 +
        noise * 0.018;

  return largeHole || smallHole || mainSlit || splitSlit || edgeTear;
}

export function isTornArea(
  u: number,
  v: number,
  expansion: number,
  columns: number,
  rows: number,
  anchor: ClothAnchor,
) {
  if (anchor === "top") {
    return isLandscapeTornArea(
      1 - v,
      u,
      expansion,
      rows,
      columns,
    );
  }

  return isLandscapeTornArea(
    u,
    v,
    expansion,
    columns,
    rows,
  );
}

export function createClothIndex(
  geometry: THREE.PlaneGeometry,
  columns: number,
  rows: number,
  anchor: ClothAnchor,
  pointedPennantHeight: number,
  torn: boolean,
) {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const keptIndices: number[] = [];
  const rowLength = columns + 1;
  const usesPointedPennant = pointedPennantHeight > 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * rowLength + column;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * rowLength + column;
      const bottomRight = bottomLeft + 1;
      const triangles =
        usesPointedPennant && column < columns / 2
          ? [
              [topLeft, bottomRight, topRight],
              [topLeft, bottomLeft, bottomRight],
            ]
          : [
              [topLeft, bottomLeft, topRight],
              [bottomLeft, bottomRight, topRight],
            ];

      for (const [a, b, c] of triangles) {
        const centerU =
          (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
        const centerV =
          (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
        const distanceFromCenter = Math.abs(centerU - 0.5) * 2;
        const outsidePennant =
          centerV < pointedPennantHeight * distanceFromCenter;
        const insideTear =
          torn &&
          isTornArea(
            centerU,
            centerV,
            0,
            columns,
            rows,
            anchor,
          );

        if (!outsidePennant && !insideTear) {
          keptIndices.push(a, b, c);
        }
      }
    }
  }

  return new THREE.BufferAttribute(new Uint16Array(keptIndices), 1);
}

export function createClothEdgeGeometry(
  sourceGeometry: THREE.BufferGeometry,
  topology: THREE.BufferAttribute,
) {
  const edgeUsage = new Map<
    string,
    { start: number; end: number; count: number }
  >();

  for (let triangle = 0; triangle < topology.count; triangle += 3) {
    const vertices = [
      topology.getX(triangle),
      topology.getX(triangle + 1),
      topology.getX(triangle + 2),
    ];
    for (let edge = 0; edge < 3; edge += 1) {
      const start = vertices[edge];
      const end = vertices[(edge + 1) % 3];
      const key =
        start < end ? `${start}:${end}` : `${end}:${start}`;
      const existing = edgeUsage.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeUsage.set(key, { start, end, count: 1 });
      }
    }
  }

  const boundaryEdges = [...edgeUsage.values()].filter(
    (edge) => edge.count === 1,
  );
  const sourceVertices: number[] = [];
  const edgeGeometry = new THREE.BufferGeometry();
  const edgePositions = new Float32Array(boundaryEdges.length * 4 * 3);
  const edgeNormals = new Float32Array(boundaryEdges.length * 4 * 3);
  const edgeSides = new Float32Array(boundaryEdges.length * 4);
  const indices: number[] = [];

  for (let edge = 0; edge < boundaryEdges.length; edge += 1) {
    const boundary = boundaryEdges[edge];
    const front = edge * 4;
    const back = front + 1;
    const nextFront = front + 2;
    const nextBack = nextFront + 1;
    indices.push(front, back, nextFront, back, nextBack, nextFront);
    sourceVertices.push(
      boundary.start,
      boundary.start,
      boundary.end,
      boundary.end,
    );
    edgeSides[front] = 1;
    edgeSides[back] = -1;
    edgeSides[nextFront] = 1;
    edgeSides[nextBack] = -1;
  }

  const positionAttribute = new THREE.BufferAttribute(edgePositions, 3);
  const normalAttribute = new THREE.BufferAttribute(edgeNormals, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  normalAttribute.setUsage(THREE.DynamicDrawUsage);
  edgeGeometry.setAttribute("position", positionAttribute);
  edgeGeometry.setAttribute("aClothNormal", normalAttribute);
  edgeGeometry.setAttribute("aSide", new THREE.BufferAttribute(edgeSides, 1));
  edgeGeometry.setIndex(indices);

  const update = () => {
    const sourcePositions = sourceGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const sourceNormals = sourceGeometry.getAttribute(
      "normal",
    ) as THREE.BufferAttribute;

    for (let vertex = 0; vertex < sourceVertices.length; vertex += 1) {
      const sourceVertex = sourceVertices[vertex];
      const sourceOffset = sourceVertex * 3;
      const targetOffset = vertex * 3;
      edgePositions[targetOffset] = sourcePositions.array[sourceOffset] as number;
      edgePositions[targetOffset + 1] = sourcePositions.array[
        sourceOffset + 1
      ] as number;
      edgePositions[targetOffset + 2] = sourcePositions.array[
        sourceOffset + 2
      ] as number;
      edgeNormals[targetOffset] = sourceNormals.array[sourceOffset] as number;
      edgeNormals[targetOffset + 1] = sourceNormals.array[
        sourceOffset + 1
      ] as number;
      edgeNormals[targetOffset + 2] = sourceNormals.array[
        sourceOffset + 2
      ] as number;
    }

    positionAttribute.needsUpdate = true;
    normalAttribute.needsUpdate = true;
  };

  update();
  return { geometry: edgeGeometry, update };
}
