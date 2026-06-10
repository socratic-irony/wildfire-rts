import { BoxHelper, Matrix4, Object3D, Raycaster, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { Path2D } from '../paths/path2d';
import { VehicleType } from './types';
import { getDefaults } from './typeDefaults';
import type { PathFollower } from './frenet';

/**
 * Vehicles that take direct point orders instead of road-projected ones:
 * bulldozers and firefighters travel cross-country, aircraft fly.
 */
export function isOffroadOrderType(t: VehicleType): boolean {
  return getDefaults(t).canOffroad;
}

/** Cruise altitude above terrain for airborne types, world units. */
function cruiseAltitude(t: VehicleType): number {
  return t === VehicleType.AIRPLANE ? 16 : 10;
}

export type FollowerEntry = {
  /** Unique identifier for this follower, shared with the dispatch system. */
  id: number;
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
  setTargetOnCurrentPath(selected, path2ds, { x: worldPos.x, z: worldPos.z });
}

const MAX_SERVICE_ROAD_DISTANCE = 12;

/**
 * Project `worldPos` onto the follower's current path and set that as its target.
 * Keeps units on their current path without cross-path teleporting.
 * Returns true if a reachable target was set, false if the position is too far
 * from the current path (unit is left where it is).
 * Off-road order types (bulldozer, firefighter, aircraft) are always routed
 * directly regardless of road distance.
 */
export function setTargetOnCurrentPath(
  selected: FollowerEntry,
  path2ds: Path2D[],
  worldPos: { x: number; z: number },
  maxRoadDistance = MAX_SERVICE_ROAD_DISTANCE,
): boolean {
  if (!canSetTargetOnCurrentPath(selected, path2ds, worldPos, maxRoadDistance)) return false;

  if (isOffroadOrderType(selected.type)) {
    selected.offroadTarget = new Vector3(worldPos.x, 0, worldPos.z);
    selected.follower.clearTarget();
    return true;
  }

  const currentIdx = path2ds.indexOf(selected.follower.path);
  if (currentIdx < 0) return false;
  const proj = path2ds[currentIdx].project(worldPos);

  selected.follower.setTargetS(proj.s, true);
  selected.offroadTarget = null;
  return true;
}

export function canSetTargetOnCurrentPath(
  selected: FollowerEntry,
  path2ds: Path2D[],
  worldPos: { x: number; z: number },
  maxRoadDistance = MAX_SERVICE_ROAD_DISTANCE,
): boolean {
  if (isOffroadOrderType(selected.type)) return true;

  const currentIdx = path2ds.indexOf(selected.follower.path);
  if (currentIdx < 0) return false;

  const proj = path2ds[currentIdx].project(worldPos);
  return proj.dist <= maxRoadDistance;
}

export function updateOffroadFollowers(followers: FollowerEntry[], hm: Heightmap, dt: number) {
  for (const entry of followers) {
    if (!isOffroadOrderType(entry.type) || !entry.offroadTarget) continue;
    if (getDefaults(entry.type).isAirborne) {
      updateAirborneFollower(entry, hm, dt);
    } else {
      updateOffroadFollower(entry, hm, dt);
    }
  }
}

// Module temps — these update functions run per off-road unit per frame.
const _oPos = new Vector3();
const _oTo = new Vector3();
const _oUp = new Vector3();
const _oFwd = new Vector3();
const _oRight = new Vector3();
const _oTan = new Vector3();
const _oM = new Matrix4();
const _oSet = new Vector3();
const _oNormal = new Vector3();

function terrainNormalAt(hm: Heightmap, wx: number, wz: number) {
  const eps = hm.scale * 0.35;
  const hL = hm.sample(wx - eps, wz);
  const hR = hm.sample(wx + eps, wz);
  const hD = hm.sample(wx, wz - eps);
  const hU = hm.sample(wx, wz + eps);
  const Hx = (hR - hL) / (2 * eps);
  const Hz = (hU - hD) / (2 * eps);
  return _oNormal.set(-Hx, 1, -Hz).normalize();
}

/** Fly toward the target at cruise altitude, easing height; hover on arrival. */
function updateAirborneFollower(entry: FollowerEntry, hm: Heightmap, dt: number) {
  if (!entry.offroadTarget) return;
  const pos = entry.object.getWorldPosition(_oPos);
  const toTarget = _oTo.set(entry.offroadTarget.x - pos.x, 0, entry.offroadTarget.z - pos.z);
  const dist = Math.hypot(toTarget.x, toTarget.z);
  const speed = getDefaults(entry.type).speedTilesPerSec * hm.scale;
  if (dist < Math.max(0.25, speed * dt)) {
    entry.offroadTarget = null;
    entry.follower.v = 0;
    return;
  }
  const dir = toTarget.multiplyScalar(1 / Math.max(1e-4, dist));
  const step = Math.min(speed * dt, dist);
  const nx = pos.x + dir.x * step;
  const nz = pos.z + dir.z * step;
  const targetY = hm.sample(nx, nz) + cruiseAltitude(entry.type);
  const ny = pos.y + (targetY - pos.y) * Math.min(1, 2.5 * dt);
  const up = _oUp.set(0, 1, 0);
  const fwd = _oFwd.set(dir.x, 0, dir.z).normalize();
  const right = _oRight.crossVectors(fwd, up).normalize();
  const m = _oM.makeBasis(right, up, fwd);
  entry.object.matrix.copy(m);
  entry.object.matrix.setPosition(_oSet.set(nx, ny, nz));
  entry.object.matrixAutoUpdate = false;
  entry.follower.v = speed;
}

function updateOffroadFollower(entry: FollowerEntry, hm: Heightmap, dt: number) {
  if (!entry.offroadTarget) return;
  const pos = entry.object.getWorldPosition(_oPos);
  const toTarget = _oTo.set(entry.offroadTarget.x - pos.x, 0, entry.offroadTarget.z - pos.z);
  const dist = Math.hypot(toTarget.x, toTarget.z);
  if (dist < 0.15) {
    entry.offroadTarget = null;
    entry.follower.v = 0;
    return;
  }
  const dir = toTarget.multiplyScalar(1 / Math.max(1e-4, dist));
  // Bulldozers keep their historical pace (the fireline audit depends on it);
  // firefighters walk at their slower type speed.
  const speed = entry.type === VehicleType.BULLDOZER ? 2.0 : getDefaults(entry.type).speedTilesPerSec * hm.scale;
  const step = Math.min(speed * dt, dist);
  const nx = pos.x + dir.x * step;
  const nz = pos.z + dir.z * step;
  const ny = hm.sample(nx, nz);
  const up = terrainNormalAt(hm, nx, nz);
  const fwd = _oFwd.set(dir.x, 0, dir.z).normalize();
  const right = _oRight.crossVectors(fwd, up).normalize();
  const tangent = _oTan.crossVectors(up, right).normalize();
  const m = _oM.makeBasis(right, up, tangent);
  entry.object.matrix.copy(m);
  entry.object.matrix.setPosition(_oSet.set(nx, ny, nz));
  entry.object.matrixAutoUpdate = false;
  entry.follower.v = speed;
}
