import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { Building, BuildingKind } from './buildings';

/**
 * Instanced building rendering: one box (walls) + one cone (roof) instance per
 * building. Per-instance color encodes kind and state — burning buildings tint
 * orange, destroyed ones collapse to charred stubs.
 */

const MAX_BUILDINGS = 128;

const WALL_COLORS: Record<BuildingKind, number[]> = {
  house: [0xe8e0d0, 0xd9c9a8, 0xc9d4dd, 0xdfd2c2],
  barn: [0xa83232, 0x9c4a3a],
  cabin: [0x7a5a3a, 0x6b4e30],
};

const ROOF_COLORS: Record<BuildingKind, number> = {
  house: 0x8a4f3d,
  barn: 0x5a4632,
  cabin: 0x4f3a26,
};

const BURNING_TINT = 0xff7733;
const DESTROYED_TINT = 0x221d1a;

export class BuildingsVisual {
  group = new Group();
  private walls: InstancedMesh;
  private roofs: InstancedMesh;
  private hm: Heightmap;
  private tmpM = new Matrix4();
  private tmpP = new Vector3();
  private tmpQ = new Quaternion();
  private tmpS = new Vector3();
  private tmpC = new Color();

  constructor(hm: Heightmap) {
    this.hm = hm;
    const s = hm.scale;
    const wallGeo = new BoxGeometry(s * 1.1, s * 0.8, s * 1.1);
    const roofGeo = new ConeGeometry(s * 0.95, s * 0.6, 4);
    roofGeo.rotateY(Math.PI / 4);
    const wallMat = new MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    const roofMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 });
    this.walls = new InstancedMesh(wallGeo, wallMat, MAX_BUILDINGS);
    this.roofs = new InstancedMesh(roofGeo, roofMat, MAX_BUILDINGS);
    this.walls.castShadow = true;
    this.walls.name = 'buildingWalls';
    this.roofs.name = 'buildingRoofs';
    this.group.add(this.walls);
    this.group.add(this.roofs);
    this.group.name = 'buildings';
  }

  /** Rebuild all instance transforms + colors from the building list. */
  update(buildings: ReadonlyArray<Building>): void {
    const s = this.hm.scale;
    const n = Math.min(buildings.length, MAX_BUILDINGS);
    for (let i = 0; i < n; i++) {
      const b = buildings[i];
      const wx = (b.tile.x + 0.5) * s;
      const wz = (b.tile.z + 0.5) * s;
      const y = this.hm.sample(wx, wz);
      const collapsed = b.state === 'destroyed';
      // Deterministic slight yaw variation so rows of houses don't look stamped.
      const yaw = ((b.id * 2654435761) % 628) / 100 * 0.15;
      this.tmpQ.setFromAxisAngle(this.tmpP.set(0, 1, 0), yaw);

      const wallH = collapsed ? s * 0.25 : s * 0.8;
      this.tmpS.set(1, collapsed ? 0.3 : 1, 1);
      this.tmpM.compose(this.tmpP.set(wx, y + wallH / 2, wz), this.tmpQ, this.tmpS);
      this.walls.setMatrixAt(i, this.tmpM);

      const roofY = collapsed ? -1000 : y + s * 0.8 + s * 0.3;
      this.tmpS.set(1, 1, 1);
      this.tmpM.compose(this.tmpP.set(wx, roofY, wz), this.tmpQ, this.tmpS);
      this.roofs.setMatrixAt(i, this.tmpM);

      const palette = WALL_COLORS[b.kind];
      const baseWall = palette[b.id % palette.length];
      const wallColor =
        b.state === 'burning' ? BURNING_TINT : b.state === 'destroyed' ? DESTROYED_TINT : baseWall;
      const roofColor =
        b.state === 'burning' ? BURNING_TINT : b.state === 'destroyed' ? DESTROYED_TINT : ROOF_COLORS[b.kind];
      this.walls.setColorAt(i, this.tmpC.set(wallColor));
      this.roofs.setColorAt(i, this.tmpC.set(roofColor));
    }
    this.walls.count = n;
    this.roofs.count = n;
    this.walls.instanceMatrix.needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;
    if (this.walls.instanceColor) this.walls.instanceColor.needsUpdate = true;
    if (this.roofs.instanceColor) this.roofs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.walls.geometry.dispose();
    this.roofs.geometry.dispose();
    (this.walls.material as MeshStandardMaterial).dispose();
    (this.roofs.material as MeshStandardMaterial).dispose();
  }
}
