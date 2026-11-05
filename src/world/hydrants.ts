import {
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
} from 'three';
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
  private capMesh: InstancedMesh | null = null;
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
  private readonly bodyGeometry = new CylinderGeometry(0.15, 0.18, 0.62, 7);
  private readonly capGeometry = new ConeGeometry(0.16, 0.18, 7);
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: 0xc84832,
    roughness: 0.62,
    metalness: 0.18,
    flatShading: true,
  });
  private readonly capMaterial = new MeshStandardMaterial({
    color: 0xe0d8c4,
    roughness: 0.52,
    metalness: 0.25,
    flatShading: true,
  });

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
    this.bodyMesh = new InstancedMesh(this.bodyGeometry, this.bodyMaterial, this.hydrants.length);
    this.capMesh = new InstancedMesh(this.capGeometry, this.capMaterial, this.hydrants.length);
    this.ringMesh = new InstancedMesh(this.ringGeometry, this.ringMaterial, this.hydrants.length);
    this.ringMesh.name = 'hydrant-rings';
    this.ringMesh.renderOrder = 6;
    this.bodyMesh.name = 'hydrant-bodies';
    this.capMesh.name = 'hydrant-caps';
    this.bodyMesh.castShadow = true;
    this.capMesh.castShadow = false;
    const dummy = new Object3D();
    this.hydrants.forEach((hydrant, i) => {
      const y = this.heightmap.heightAt(hydrant.x, hydrant.z);
      dummy.position.set(hydrant.x, y + 0.31, hydrant.z);
      dummy.rotation.y = i * 0.7;
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.bodyMesh?.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 0.71;
      dummy.updateMatrix();
      this.capMesh?.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 0.07;
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      this.ringMesh?.setMatrixAt(i, dummy.matrix);
    });
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.capMesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.computeBoundingSphere();
    this.group.add(this.bodyMesh, this.capMesh, this.ringMesh);
  }

  private disposeMeshes(): void {
    for (const mesh of [this.bodyMesh, this.capMesh, this.ringMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.bodyMesh = null;
    this.capMesh = null;
    this.ringMesh = null;
  }

  dispose(): void {
    this.disposeMeshes();
    this.bodyGeometry.dispose();
    this.capGeometry.dispose();
    this.bodyMaterial.dispose();
    this.capMaterial.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }
}
