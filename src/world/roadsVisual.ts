import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { hash2 } from '../core/rng';
import { GRID_SIZE, TILE_SIZE } from './constants';
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

function addQuad(
  buffers: QuadBuffers,
  h: Heightmap,
  tx: number,
  tz: number,
  lift: number,
  expansion: number,
  color: { r: number; g: number; b: number },
): void {
  const x0 = tx * TILE_SIZE - expansion;
  const x1 = (tx + 1) * TILE_SIZE + expansion;
  const z0 = tz * TILE_SIZE - expansion;
  const z1 = (tz + 1) * TILE_SIZE + expansion;
  const y00 = h.vertexHeight(tx, tz) + lift;
  const y10 = h.vertexHeight(tx + 1, tz) + lift;
  const y01 = h.vertexHeight(tx, tz + 1) + lift;
  const y11 = h.vertexHeight(tx + 1, tz + 1) + lift;
  const base = buffers.positions.length / 3;
  buffers.positions.push(x0, y00, z0, x0, y01, z1, x1, y10, z0, x1, y10, z0, x0, y01, z1, x1, y11, z1);
  for (let i = 0; i < 6; i += 1) buffers.colors.push(color.r, color.g, color.b);
  buffers.indices.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
}

function addMarking(
  buffers: QuadBuffers,
  h: Heightmap,
  tx: number,
  tz: number,
  horizontal: boolean,
  color: { r: number; g: number; b: number },
): void {
  const cx = (tx + 0.5) * TILE_SIZE;
  const cz = (tz + 0.5) * TILE_SIZE;
  const y = h.heightAt(cx, cz) + 0.09;
  const halfLong = TILE_SIZE * 0.31;
  const halfWide = 0.075;
  const x0 = cx - (horizontal ? halfLong : halfWide);
  const x1 = cx + (horizontal ? halfLong : halfWide);
  const z0 = cz - (horizontal ? halfWide : halfLong);
  const z1 = cz + (horizontal ? halfWide : halfLong);
  const base = buffers.positions.length / 3;
  buffers.positions.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
  for (let i = 0; i < 6; i += 1) buffers.colors.push(color.r, color.g, color.b);
  buffers.indices.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
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
      addQuad(shoulders, heightmap, tx, tz, 0.025, 0.36, { r: 0.44, g: 0.38, b: 0.27 });
      addQuad(asphalt, heightmap, tx, tz, 0.045, 0.04, {
        r: 0.19 + variation * 0.035,
        g: 0.195 + variation * 0.035,
        b: 0.2 + variation * 0.035,
      });

      const mask = network.connectionMask(tx, tz);
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
      flatShading: false,
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

  screenshotSafeCount(): number {
    return GRID_SIZE * GRID_SIZE;
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
