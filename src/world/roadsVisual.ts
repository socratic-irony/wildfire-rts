import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { hash2 } from '../core/rng';
import { TILE_SIZE } from './constants';
import { Heightmap } from './heightmap';
import { RoadNetwork } from './roads';

interface QuadBuffers {
  positions: number[];
  colors: number[];
  indices: number[];
}

function createBuffers(): QuadBuffers {
  return { positions: [], colors: [], indices: [] };
}

type Rgb = { r: number; g: number; b: number };
type P3 = [number, number, number];

function pushTri(buffers: QuadBuffers, a: P3, b: P3, c: P3, color: Rgb): void {
  const base = buffers.positions.length / 3;
  buffers.positions.push(...a, ...b, ...c);
  for (let i = 0; i < 3; i += 1) buffers.colors.push(color.r, color.g, color.b);
  buffers.indices.push(base, base + 1, base + 2);
}

/** Quad a-b-c-d (counter-clockwise seen from above) as two triangles. */
function pushQuad(buffers: QuadBuffers, a: P3, b: P3, c: P3, d: P3, color: Rgb): void {
  pushTri(buffers, a, b, c, color);
  pushTri(buffers, a, c, d, color);
}

/**
 * Point on the road surface: the tile's own triangulated plane, lifted.
 * Road tiles are graded planar (flat pads or straight ramps), so this is exact.
 */
function surface(h: Heightmap, x: number, z: number, lift: number): P3 {
  return [x, h.heightAt(x, z) + lift, z];
}

const SHOULDER = 0.34;
const EDGE_LINE = 0.12;
const EDGE_INSET = 0.12;

/**
 * Draw one road tile: asphalt on the exact tile, solid edge lines and a dusty
 * shoulder on every side that does not continue into another road tile. The
 * shoulder's outer edge is draped onto the neighbouring terrain so it never
 * floats over a fill slope or vanishes into a cut.
 */
function addRoadTile(
  asphalt: QuadBuffers,
  shoulders: QuadBuffers,
  markings: QuadBuffers,
  h: Heightmap,
  tx: number,
  tz: number,
  mask: number,
  asphaltColor: Rgb,
): void {
  const x0 = tx * TILE_SIZE;
  const x1 = x0 + TILE_SIZE;
  const z0 = tz * TILE_SIZE;
  const z1 = z0 + TILE_SIZE;
  const lift = 0.045;
  const v00: P3 = [x0, h.vertexHeight(tx, tz) + lift, z0];
  const v10: P3 = [x1, h.vertexHeight(tx + 1, tz) + lift, z0];
  const v01: P3 = [x0, h.vertexHeight(tx, tz + 1) + lift, z1];
  const v11: P3 = [x1, h.vertexHeight(tx + 1, tz + 1) + lift, z1];
  pushTri(asphalt, v00, v01, v10, asphaltColor);
  pushTri(asphalt, v10, v01, v11, asphaltColor);

  const shoulderColor = { r: 0.5, g: 0.43, b: 0.31 };
  const lineColor = { r: 0.86, g: 0.84, b: 0.76 };
  const sides = [
    { bit: 1, a: [x0, z0], b: [x1, z0], out: [0, -1] },
    { bit: 2, a: [x1, z0], b: [x1, z1], out: [1, 0] },
    { bit: 4, a: [x1, z1], b: [x0, z1], out: [0, 1] },
    { bit: 8, a: [x0, z1], b: [x0, z0], out: [-1, 0] },
  ] as const;
  for (const side of sides) {
    if (mask & side.bit) continue;
    const [ax, az] = side.a;
    const [bx, bz] = side.b;
    const [ox, oz] = side.out;
    // Shoulder strip: inner edge on the tile border, outer edge on the terrain.
    const innerA = surface(h, ax, az, 0.03);
    const innerB = surface(h, bx, bz, 0.03);
    const outerA = surface(h, ax + ox * SHOULDER, az + oz * SHOULDER, 0.03);
    const outerB = surface(h, bx + ox * SHOULDER, bz + oz * SHOULDER, 0.03);
    pushQuad(shoulders, innerA, innerB, outerB, outerA, shoulderColor);
    // Solid edge line, inset onto the asphalt.
    const ix = -ox;
    const iz = -oz;
    const la = surface(h, ax + ix * EDGE_INSET, az + iz * EDGE_INSET, 0.07);
    const lb = surface(h, bx + ix * EDGE_INSET, bz + iz * EDGE_INSET, 0.07);
    const lc = surface(h, bx + ix * (EDGE_INSET + EDGE_LINE), bz + iz * (EDGE_INSET + EDGE_LINE), 0.07);
    const ld = surface(h, ax + ix * (EDGE_INSET + EDGE_LINE), az + iz * (EDGE_INSET + EDGE_LINE), 0.07);
    pushQuad(markings, la, ld, lc, lb, lineColor);
  }
  // Outer corners where two shouldered sides meet.
  const corners = [
    { bits: 1 | 8, x: x0, z: z0, dx: -1, dz: -1 },
    { bits: 1 | 2, x: x1, z: z0, dx: 1, dz: -1 },
    { bits: 4 | 2, x: x1, z: z1, dx: 1, dz: 1 },
    { bits: 4 | 8, x: x0, z: z1, dx: -1, dz: 1 },
  ];
  for (const c of corners) {
    if ((mask & c.bits) !== 0) continue;
    const p = surface(h, c.x, c.z, 0.03);
    const px = surface(h, c.x + c.dx * SHOULDER, c.z, 0.03);
    const pz = surface(h, c.x, c.z + c.dz * SHOULDER, 0.03);
    const pxz = surface(h, c.x + c.dx * SHOULDER, c.z + c.dz * SHOULDER, 0.03);
    const ccw = c.dx * c.dz > 0;
    if (ccw) pushQuad(shoulders, p, pz, pxz, px, shoulderColor);
    else pushQuad(shoulders, p, px, pxz, pz, shoulderColor);
  }
}

/** Centre dash on a straight tile, draped on the (planar) road surface. */
function addMarking(buffers: QuadBuffers, h: Heightmap, tx: number, tz: number, horizontal: boolean, color: Rgb): void {
  const cx = (tx + 0.5) * TILE_SIZE;
  const cz = (tz + 0.5) * TILE_SIZE;
  const halfLong = TILE_SIZE * 0.26;
  const halfWide = 0.07;
  const hx = horizontal ? halfLong : halfWide;
  const hz = horizontal ? halfWide : halfLong;
  pushQuad(
    buffers,
    surface(h, cx - hx, cz - hz, 0.075),
    surface(h, cx - hx, cz + hz, 0.075),
    surface(h, cx + hx, cz + hz, 0.075),
    surface(h, cx + hx, cz - hz, 0.075),
    color,
  );
}

function toGeometry(buffers: QuadBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class RoadVisual {
  readonly group = new Group();
  private shoulderMesh: Mesh | null = null;
  private asphaltMesh: Mesh | null = null;
  private markingMesh: Mesh | null = null;

  constructor() {
    this.group.name = 'roads';
  }

  rebuild(network: RoadNetwork, heightmap: Heightmap, seed: number): void {
    this.disposeMeshes();
    const shoulders = createBuffers();
    const asphalt = createBuffers();
    const markings = createBuffers();

    network.forEach((tx, tz) => {
      const variation = hash2(tx, tz, seed + 33) / 0xffffffff;
      const mask = network.connectionMask(tx, tz);
      addRoadTile(asphalt, shoulders, markings, heightmap, tx, tz, mask, {
        r: 0.19 + variation * 0.035,
        g: 0.195 + variation * 0.035,
        b: 0.2 + variation * 0.035,
      });

      const horizontal = (mask & 2) !== 0 && (mask & 8) !== 0 && (mask & 1) === 0 && (mask & 4) === 0;
      const vertical = (mask & 1) !== 0 && (mask & 4) !== 0 && (mask & 2) === 0 && (mask & 8) === 0;
      if (horizontal || vertical) {
        addMarking(markings, heightmap, tx, tz, horizontal, { r: 0.94, g: 0.77, b: 0.35 });
      }
    });

    const shoulderMaterial = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
      flatShading: true,
    });
    shoulderMaterial.polygonOffset = true;
    shoulderMaterial.polygonOffsetFactor = -1;
    shoulderMaterial.polygonOffsetUnits = -1;
    this.shoulderMesh = new Mesh(toGeometry(shoulders), shoulderMaterial);
    this.shoulderMesh.receiveShadow = true;
    this.shoulderMesh.name = 'road-shoulders';

    const asphaltMaterial = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.03,
      flatShading: true,
    });
    asphaltMaterial.polygonOffset = true;
    asphaltMaterial.polygonOffsetFactor = -2;
    asphaltMaterial.polygonOffsetUnits = -2;
    this.asphaltMesh = new Mesh(toGeometry(asphalt), asphaltMaterial);
    this.asphaltMesh.receiveShadow = true;
    this.asphaltMesh.name = 'road-asphalt';

    const markingMaterial = new MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
    });
    markingMaterial.polygonOffset = true;
    markingMaterial.polygonOffsetFactor = -4;
    markingMaterial.polygonOffsetUnits = -4;
    this.markingMesh = new Mesh(toGeometry(markings), markingMaterial);
    this.markingMesh.name = 'road-markings';

    this.group.add(this.shoulderMesh, this.asphaltMesh, this.markingMesh);
  }

  disposeMeshes(): void {
    for (const mesh of [this.shoulderMesh, this.asphaltMesh, this.markingMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) material.dispose();
      } else {
        mesh.material.dispose();
      }
    }
    this.shoulderMesh = null;
    this.asphaltMesh = null;
    this.markingMesh = null;
  }
}
