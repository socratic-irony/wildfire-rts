import {
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
} from 'three';
import { ModelBuilder } from '../core/modelBuilder';
import { MODEL_BODY } from '../core/modelMaterials';
import { TILE_SIZE } from './constants';
import { Heightmap } from './heightmap';
import { RoadNetwork } from './roads';

export interface Hydrant {
  id: number;
  tileX: number;
  tileZ: number;
  x: number;
  z: number;
  active: boolean;
}

export class HydrantSystem {
  readonly hydrants: Hydrant[] = [];
  readonly group = new Group();
  private bodyMesh: InstancedMesh | null = null;
  private ringMesh: InstancedMesh | null = null;
  private readonly ringGeometry = new RingGeometry(0.42, 0.6, 20).rotateX(-Math.PI / 2);
  /** Cyan ground ring under every hydrant so refill points read at a glance. */
  private readonly ringMaterial = new MeshBasicMaterial({
    color: 0x6fe4ff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  private highlight = 0;
  private readonly bodyGeometry = createHydrantGeometry();

  constructor(
    private readonly heightmap: Heightmap,
    roads: RoadNetwork,
    private readonly minSpacingTiles = 5,
  ) {
    this.group.name = 'hydrants';
    this.rebuild(roads);
  }

  rebuild(roads: RoadNetwork): void {
    this.disposeMeshes();
    this.hydrants.length = 0;
    const placed: Hydrant[] = [];
    const candidates: Array<{ tx: number; tz: number; index: number }> = [];
    roads.forEach((tx, tz, index) => candidates.push({ tx, tz, index }));
    candidates.sort((a, b) => a.index - b.index);
    let side = 1;
    for (const candidate of candidates) {
      const { tx, tz } = candidate;
      if (placed.some((h) => Math.hypot(h.tileX - tx, h.tileZ - tz) < this.minSpacingTiles)) continue;
      if (roads.connectionMask(tx, tz) === 0) continue;
      const horizontal = roads.has(tx - 1, tz) || roads.has(tx + 1, tz);
      const offset = 1.18;
      const wx = (tx + 0.5) * TILE_SIZE + (horizontal ? 0 : offset * side);
      const wz = (tz + 0.5) * TILE_SIZE + (horizontal ? offset * side : 0);
      side *= -1;
      const hydrant: Hydrant = {
        id: placed.length + 1,
        tileX: tx,
        tileZ: tz,
        x: wx,
        z: wz,
        active: true,
      };
      placed.push(hydrant);
    }
    this.hydrants.push(...placed);
    this.buildMeshes();
  }

  findNearest(x: number, z: number, maxDistance = 7): Hydrant | null {
    let best: Hydrant | null = null;
    let bestDist = maxDistance;
    for (const hydrant of this.hydrants) {
      if (!hydrant.active) continue;
      const dist = Math.hypot(hydrant.x - x, hydrant.z - z);
      if (dist < bestDist) {
        best = hydrant;
        bestDist = dist;
      }
    }
    return best;
  }

  byId(id: number): Hydrant | null {
    return this.hydrants[id - 1]?.id === id ? (this.hydrants[id - 1] ?? null) : (this.hydrants.find((h) => h.id === id) ?? null);
  }

  isNear(x: number, z: number, radius = 4.2): boolean {
    return this.findNearest(x, z, radius) !== null;
  }

  nearestRoadTile(x: number, z: number): { x: number; z: number } {
    let best = { x: 0, z: 0 };
    let bestDist = Infinity;
    for (const hydrant of this.hydrants) {
      const dist = Math.hypot(hydrant.x - x, hydrant.z - z);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: hydrant.tileX, z: hydrant.tileZ };
      }
    }
    return best;
  }

  get count(): number {
    return this.hydrants.length;
  }

  /** 0 = quiet rings, 1 = bright (an engine is selected or running low). */
  setHighlight(strength: number): void {
    const next = Math.max(0, Math.min(1, strength));
    if (Math.abs(next - this.highlight) < 0.01) return;
    this.highlight = next;
    this.ringMaterial.opacity = 0.32 + next * 0.5;
  }

  private buildMeshes(): void {
    if (this.hydrants.length === 0) return;
    this.bodyMesh = new InstancedMesh(this.bodyGeometry, MODEL_BODY, this.hydrants.length);
    this.ringMesh = new InstancedMesh(this.ringGeometry, this.ringMaterial, this.hydrants.length);
    this.ringMesh.name = 'hydrant-rings';
    this.ringMesh.renderOrder = 6;
    this.bodyMesh.name = 'hydrants';
    this.bodyMesh.castShadow = true;
    const dummy = new Object3D();
    this.hydrants.forEach((hydrant, i) => {
      const y = this.heightmap.heightAt(hydrant.x, hydrant.z);
      dummy.position.set(hydrant.x, y, hydrant.z);
      dummy.rotation.y = i * 0.7;
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.bodyMesh?.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 0.07;
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      this.ringMesh?.setMatrixAt(i, dummy.matrix);
    });
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.bodyMesh.computeBoundingSphere();
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.computeBoundingSphere();
    this.group.add(this.bodyMesh, this.ringMesh);
  }

  private disposeMeshes(): void {
    for (const mesh of [this.bodyMesh, this.ringMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.bodyMesh = null;
    this.ringMesh = null;
  }

  dispose(): void {
    this.disposeMeshes();
    this.bodyGeometry.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }
}

/**
 * Post hydrant, about 1.2 m tall: drawn a little over real size (0.4 units)
 * so it reads at RTS zoom, with a white bonnet and side outlets.
 */
export function createHydrantGeometry(): BufferGeometry {
  const b = new ModelBuilder();
  const red = 0xc63c2c;
  const cap = 0xece4cf;
  b.cylinder(0.11, 0.05, 0x6f7472, 0, 0.025, 0, undefined, 8);
  b.cylinder(0.075, 0.26, red, 0, 0.17, 0, undefined, 8, 0.92);
  b.cylinder(0.085, 0.03, cap, 0, 0.3, 0, undefined, 8);
  b.sphere(0.075, 0.06, 0.075, cap, 0, 0.32, 0, 8, true);
  b.cylinder(0.015, 0.04, cap, 0, 0.39, 0, undefined, 5);
  for (const side of [-1, 1]) b.cylinder(0.035, 0.08, cap, side * 0.09, 0.2, 0, { z: Math.PI / 2 }, 6);
  b.cylinder(0.045, 0.07, cap, 0, 0.2, 0.09, { x: Math.PI / 2 }, 6);
  return b.build().get('body')!;
}
