import { BoxHelper, Matrix4, Object3D, Raycaster, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { Path2D } from '../paths/path2d';
import { VehicleType } from './types';
import type { PathFollower } from './frenet';

export type FollowerEntry = {
  follower: PathFollower;
  object: Object3D;
  mesh: Object3D;
  type: VehicleType;
  offroadTarget?: Vector3 | null;
};

export type SelectionController = {
  getSelected: () => FollowerEntry | null;
  select: (entry: FollowerEntry | null) => void;
  update: () => void;
  clear: () => void;
};

export function createFollowerSelection(scene: Object3D): SelectionController {
  let selected: FollowerEntry | null = null;
  let selectionBox: BoxHelper | null = null;

  const select = (entry: FollowerEntry | null) => {
    if (selectionBox && selectionBox.parent) selectionBox.parent.remove(selectionBox);
    selected = entry;
    if (selected) {
      selectionBox = new BoxHelper(selected.object, 0x39ff14);
      selectionBox.renderOrder = 20;
      scene.add(selectionBox);
    } else {
      selectionBox = null;
    }
  };

  return {
    getSelected: () => selected,
    select,
    update: () => {
      if (selectionBox && selected) selectionBox.update();
    },
    clear: () => select(null),
  };
}

export function findFollowerHit(ray: Raycaster, followers: FollowerEntry[]): FollowerEntry | null {
  if (!followers.length) return null;
  const meshes = followers.map(f => f.mesh);
  const hits = ray.intersectObjects(meshes, true);
  if (!hits.length) return null;
  const hitObj = hits[0].object;
  return followers.find(f => f.mesh === hitObj || f.mesh.children.includes(hitObj as any)) ?? null;
}

export function issueMoveOrder(
  selected: FollowerEntry,
  path2ds: Path2D[],
  worldPos: Vector3
) {
  if (selected.type === VehicleType.BULLDOZER) {
    selected.offroadTarget = worldPos.clone();
    selected.follower.clearTarget();
    return;
  }
  if (!path2ds.length) return;
  const target = { x: worldPos.x, z: worldPos.z };
  let bestIdx = 0;
  let bestDist = Infinity;
  let bestProj = path2ds[0].project(target);
  for (let i = 0; i < path2ds.length; i++) {
    const proj = path2ds[i].project(target);
    if (proj.dist < bestDist) {
      bestDist = proj.dist;
      bestIdx = i;
      bestProj = proj;
    }
  }
  const curPos = selected.object.getWorldPosition(new Vector3());
  const curProj = path2ds[bestIdx].project({ x: curPos.x, z: curPos.z });
  selected.follower.path = path2ds[bestIdx];
  selected.follower.s = curProj.s;
  selected.follower.setTargetS(bestProj.s, true);
  selected.offroadTarget = null;
}

export function updateOffroadFollowers(followers: FollowerEntry[], hm: Heightmap, dt: number) {
  for (const entry of followers) {
    if (entry.type !== VehicleType.BULLDOZER || !entry.offroadTarget) continue;
    updateOffroadFollower(entry, hm, dt);
  }
}

function terrainNormalAt(hm: Heightmap, wx: number, wz: number) {
  const eps = hm.scale * 0.35;
  const hL = hm.sample(wx - eps, wz);
  const hR = hm.sample(wx + eps, wz);
  const hD = hm.sample(wx, wz - eps);
  const hU = hm.sample(wx, wz + eps);
  const Hx = (hR - hL) / (2 * eps);
  const Hz = (hU - hD) / (2 * eps);
  const n = new Vector3(-Hx, 1, -Hz);
  n.normalize();
  return n;
}

function updateOffroadFollower(entry: FollowerEntry, hm: Heightmap, dt: number) {
  if (!entry.offroadTarget) return;
  const pos = entry.object.getWorldPosition(new Vector3());
  const toTarget = new Vector3(entry.offroadTarget.x - pos.x, 0, entry.offroadTarget.z - pos.z);
  const dist = Math.hypot(toTarget.x, toTarget.z);
  if (dist < 0.15) {
    entry.offroadTarget = null;
    entry.follower.v = 0;
    return;
  }
  const dir = toTarget.multiplyScalar(1 / Math.max(1e-4, dist));
  const speed = 2.0;
  const step = Math.min(speed * dt, dist);
  const nx = pos.x + dir.x * step;
  const nz = pos.z + dir.z * step;
  const ny = hm.sample(nx, nz);
  const up = terrainNormalAt(hm, nx, nz);
  const fwd = new Vector3(dir.x, 0, dir.z).normalize();
  const right = new Vector3().crossVectors(fwd, up).normalize();
  const tangent = new Vector3().crossVectors(up, right).normalize();
  const m = new Matrix4().makeBasis(right, up, tangent);
  entry.object.matrix.copy(m);
  entry.object.matrix.setPosition(new Vector3(nx, ny, nz));
  entry.object.matrixAutoUpdate = false;
  entry.follower.v = speed;
}
