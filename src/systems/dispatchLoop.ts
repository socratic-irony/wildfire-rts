/**
 * Dispatch loop — runs periodically to wire fire detection into unit dispatch.
 *
 * Responsibilities:
 *  1. Detect new incidents from the fire grid (delegates to IncidentRegistry).
 *  2. Auto-assign the nearest idle unit to each detected incident.
 *  3. Push movement goals onto PathFollower vehicles.
 *  4. Promote incidents to 'engaged' when the assigned unit arrives.
 *  5. Mark incidents 'resolved' when fire cools or the unit drains water.
 *
 * This is intentionally a small, focused module — all strategy-layer state lives
 * in incident.ts / assignment.ts; dispatchLoop just drives the transitions.
 */

import type { FireGrid } from '../fire/grid';
import type { Path2D } from '../paths/path2d';
import type { PathFollower } from '../vehicles/frenet';
import type { IncidentRegistry } from '../dispatch/incident';
import { assignNearestIdle, type DispatchableUnit } from '../dispatch/assignment';
import { VehicleType } from '../vehicles/types';

/** Minimal XZ position interface used to avoid Three.js dependency in tests. */
type Pos2D = { x: number; z: number };
/** Minimal Vector3-like return from getWorldPosition. */
type WorldPos = { x: number; y: number; z: number };

// Distance (world units) within which a unit is considered "on site" / engaged.
const ENGAGE_RADIUS = 8;
// Distance (world units) within which an idle unit can be auto-dispatched.
const MAX_DISPATCH_RADIUS = 400;

export type FollowerRef = {
  id: number;
  type: VehicleType;
  follower: PathFollower;
  /** Whether this unit is currently assigned to an incident. */
  busy: boolean;
};

export type DispatchLoopOptions = {
  /** How often (in sim seconds) to run incident detection. Default 1.0. */
  detectInterval?: number;
  /** Whether auto-dispatch is enabled. Can be toggled at runtime. */
  autoDispatch?: boolean;
};

export type DispatchLoop = {
  /** Advance the dispatch loop by dt seconds of sim time. */
  tick(
    dt: number,
    simSeconds: number,
    fireGrid: FireGrid,
    followers: FollowerRef[],
    path2ds: Path2D[]
  ): void;

  /** Toggle auto-dispatch on/off. Returns new value. */
  setAutoDispatch(on: boolean): void;
  getAutoDispatch(): boolean;

  /** Manually mark an incident as assigned to a follower (registry only; caller pushes goal). */
  manualDispatch(incidentId: number, followerId: number, simSeconds: number): boolean;

  /** Exposed registry for UI read access. */
  readonly registry: IncidentRegistry;
};

export function createDispatchLoop(
  registry: IncidentRegistry,
  opts: DispatchLoopOptions = {}
): DispatchLoop {
  const detectInterval = opts.detectInterval ?? 1.0;
  let autoDispatch = opts.autoDispatch ?? true;
  let detectAcc = 0;
  // Track which follower ids are dispatched to which incident
  const unitToIncident = new Map<number, number>(); // followerId → incidentId

  function followerWorldPos(f: FollowerRef): Pos2D {
    const tmp: WorldPos = { x: 0, y: 0, z: 0 };
    // PathFollower.object is an Object3D; getWorldPosition mutates the arg and returns it.
    // We pass a plain object matching the Vector3 interface (x, y, z) to avoid
    // pulling in Three.js here. The real Three.js Object3D accepts any Vector3Like.
    f.follower.object.getWorldPosition(tmp as unknown as Parameters<typeof f.follower.object.getWorldPosition>[0]);
    return { x: tmp.x, z: tmp.z };
  }

  function dist2d(a: Pos2D, b: Pos2D): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function pushGoal(follower: PathFollower, incidentPos: Pos2D, path2ds: Path2D[]): void {
    if (!path2ds.length) return;
    const target = { x: incidentPos.x, z: incidentPos.z };
    let bestIdx = 0, bestDist = Infinity, bestS = 0;
    for (let i = 0; i < path2ds.length; i++) {
      const proj = path2ds[i].project(target);
      if (proj.dist < bestDist) { bestDist = proj.dist; bestS = proj.s; bestIdx = i; }
    }
    const curTmp: WorldPos = { x: 0, y: 0, z: 0 };
    follower.object.getWorldPosition(curTmp as unknown as Parameters<typeof follower.object.getWorldPosition>[0]);
    const curProj = path2ds[bestIdx].project({ x: curTmp.x, z: curTmp.z });
    follower.path = path2ds[bestIdx];
    follower.s = curProj.s;
    follower.setTargetS(bestS, true);
  }

  function isSuppression(type: VehicleType): boolean {
    return (
      type === VehicleType.FIRETRUCK ||
      type === VehicleType.HELICOPTER ||
      type === VehicleType.AIRPLANE ||
      type === VehicleType.FIREFIGHTER
    );
  }

  return {
    registry,

    setAutoDispatch(on) { autoDispatch = on; },
    getAutoDispatch() { return autoDispatch; },

    manualDispatch(incidentId, followerId, simSeconds) {
      const inc = registry.byId(incidentId);
      if (!inc || inc.status === 'resolved' || inc.status === 'engaged') return false;
      // Mark assignment in registry; the caller must also push a movement goal
      // using pushGoal (they hold the PathFollower reference directly).
      registry.markAssigned(incidentId, [followerId], simSeconds);
      unitToIncident.set(followerId, incidentId);
      return true;
    },

    tick(dt, simSeconds, fireGrid, followers, path2ds) {
      detectAcc += dt;

      // — Step 1: periodic detection —
      if (detectAcc >= detectInterval) {
        detectAcc = 0;

        // Rebuild registry with new fire tiles
        registry.detectFromFireGrid(fireGrid, simSeconds);
        // Auto-resolve incidents where fire is out
        registry.prune(fireGrid, simSeconds);
      }

      // — Step 2: auto-assign unassigned incidents —
      if (autoDispatch) {
        const unassigned = registry.list().filter(i => i.status === 'detected');
        if (unassigned.length > 0) {
          const units: DispatchableUnit[] = followers
            .filter(f => !f.busy && isSuppression(f.type))
            .map(f => {
              const p = followerWorldPos(f);
              return { id: f.id, type: f.type, pos: p, busy: f.busy };
            });

          const assignments = assignNearestIdle(unassigned, units);
          for (const asn of assignments) {
            const inc = registry.byId(asn.incidentId);
            if (!inc) continue;
            // Only dispatch if unit is within range
            const unit = units.find(u => u.id === asn.unitIds[0]);
            if (!unit) continue;
            if (dist2d(unit.pos, inc.pos) > MAX_DISPATCH_RADIUS) continue;

            registry.markAssigned(asn.incidentId, asn.unitIds, simSeconds);
            for (const uid of asn.unitIds) {
              unitToIncident.set(uid, asn.incidentId);
              const ref = followers.find(f => f.id === uid);
              if (ref) {
                ref.busy = true;
                pushGoal(ref.follower, inc.pos, path2ds);
              }
            }
          }
        }
      }

      // — Step 3: check engagement / resolution —
      for (const inc of registry.list()) {
        if (inc.status === 'assigned') {
          // Check if any assigned unit has arrived
          for (const uid of inc.assignedFollowerIds) {
            const ref = followers.find(f => f.id === uid);
            if (!ref) continue;
            const d = dist2d(followerWorldPos(ref), inc.pos);
            if (d <= ENGAGE_RADIUS) {
              registry.markEngaged(inc.id, simSeconds);
              break;
            }
          }
        } else if (inc.status === 'engaged') {
          // Check if the incident tile is no longer burning (handled by prune),
          // or if assigned units no longer exist (unit cleared)
          const anyAlive = inc.assignedFollowerIds.some(uid => followers.find(f => f.id === uid));
          if (!anyAlive) {
            registry.markResolved(inc.id, simSeconds);
          }
        } else if (inc.status === 'resolved') {
          // Release busy status for units assigned to this incident
          for (const uid of inc.assignedFollowerIds) {
            unitToIncident.delete(uid);
            const ref = followers.find(f => f.id === uid);
            if (ref) ref.busy = false;
          }
        }
      }
    },
  };
}
