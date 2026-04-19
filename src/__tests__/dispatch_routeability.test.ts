/**
 * Regression tests for dispatch routeability — ensures incidents are never
 * marked 'assigned' unless at least one unit could actually be routed to them
 * from its current road.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, FireState } from '../fire/grid';
import { createIncidentRegistry } from '../dispatch/incident';
import { createDispatchLoop, type FollowerRef } from '../systems/dispatchLoop';
import { VehicleType } from '../vehicles/types';
import type { Path2D } from '../paths/path2d';
import type { PathFollower } from '../vehicles/frenet';

// ── helpers ──────────────────────────────────────────────────────────────────

function flatGrid(size = 16) {
  const hm = generateHeightmap(size, size, 1, {
    seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1,
  });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, { cellSize: 1 });
}

/**
 * Build a minimal Path2D mock whose `project` returns the perpendicular
 * distance from the given world point to the line segment (x0,z0)→(x1,z1).
 */
function makePath(
  x0: number, z0: number,
  x1: number, z1: number,
): Path2D {
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  return {
    length: len,
    closed: false,
    project(p: { x: number; z: number }) {
      // Project p onto the segment and compute perpendicular dist.
      const dx = x1 - x0, dz = z1 - z0;
      const ab2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.z - z0) * dz) / ab2));
      const cx = x0 + t * dx, cz = z0 + t * dz;
      const dist = Math.hypot(p.x - cx, p.z - cz);
      return { s: t * len, dist, t: { x: dx / len, z: dz / len } };
    },
    sample: () => ({ p: { x: x0, z: z0 }, t: { x: 1, z: 0 } }),
    curvature: () => 0,
  } as unknown as Path2D;
}

function makeFollowerRef(
  id: number,
  path: Path2D,
  worldX: number,
  worldZ: number,
  type = VehicleType.FIRETRUCK,
): FollowerRef {
  const setTargetS = vi.fn();
  const follower: PathFollower = {
    path,
    s: 0,
    v: 0,
    closed: false,
    length: path.length,
    setTargetS,
    clearTarget: vi.fn(),
    setLeader: vi.fn(),
    setSpacingMode: vi.fn(),
    setSpeedCap: vi.fn(),
    update: vi.fn(),
    object: {
      getWorldPosition(out: any) { out.x = worldX; out.y = 0; out.z = worldZ; return out; },
    },
  } as unknown as PathFollower;

  return { id, type, follower, busy: false };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('dispatch_routeability', () => {
  it('auto-dispatch leaves incident "detected" when incident is too far from follower road', () => {
    const grid = flatGrid();

    // Fire at tile (2, 2) — world pos (2.5, 2.5) with cellSize=1
    grid.tiles[2 * 16 + 2].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    registry.detectFromFireGrid(grid, 0);
    expect(registry.list().length).toBe(1);
    const inc = registry.list()[0];
    expect(inc.status).toBe('detected');

    // Road runs along z=0 (far from fire at z≈2.5).
    // The perpendicular distance from the incident to this road is ~2.5 units,
    // but we force a very short road with huge offset to ensure dist > 12.
    const farPath = makePath(0, 0, 100, 0); // road along z=0

    // Follower is on this road, near world origin (within MAX_DISPATCH_RADIUS)
    const ref = makeFollowerRef(1, farPath, 2.5, 0);

    // Override project so dist > 12 (incident is far from road)
    (farPath as any).project = (_p: any) => ({ s: 0, dist: 50, t: { x: 1, z: 0 } });

    const loop = createDispatchLoop(registry, { autoDispatch: true, detectInterval: 0 });
    loop.tick(1.0, 1.0, grid, [ref], [farPath]);

    // Incident must remain 'detected' — no unit was successfully routed
    expect(registry.byId(inc.id)?.status).toBe('detected');
    expect(ref.busy).toBe(false);
  });

  it('auto-dispatch marks incident "assigned" when incident is close to follower road', () => {
    const grid = flatGrid();

    // Fire at tile (2, 0)
    grid.tiles[0 * 16 + 2].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    registry.detectFromFireGrid(grid, 0);
    const inc = registry.list()[0];

    // Road runs along z=0; incident at z≈0.5 → dist < 12
    const nearPath = makePath(0, 0, 100, 0);

    // dist returned is 1 (well within 12 m threshold)
    (nearPath as any).project = (_p: any) => ({ s: 50, dist: 1, t: { x: 1, z: 0 } });

    const ref = makeFollowerRef(1, nearPath, 2.5, 0);

    const loop = createDispatchLoop(registry, { autoDispatch: true, detectInterval: 0 });
    loop.tick(1.0, 1.0, grid, [ref], [nearPath]);

    expect(registry.byId(inc.id)?.status === 'assigned' || registry.byId(inc.id)?.status === 'engaged').toBe(true);
    expect(ref.busy).toBe(true);
  });

  it('auto-dispatch does not mark busy when follower is not on any known path', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    registry.detectFromFireGrid(grid, 0);
    const inc = registry.list()[0];

    const knownPath = makePath(0, 0, 100, 0);
    const followerPath = makePath(200, 200, 300, 200); // not in path2ds list

    const ref = makeFollowerRef(1, followerPath, 0.5, 0.5);

    const loop = createDispatchLoop(registry, { autoDispatch: true, detectInterval: 0 });
    // path2ds contains knownPath only — follower is on a different path
    loop.tick(1.0, 1.0, grid, [ref], [knownPath]);

    expect(ref.busy).toBe(false);
    expect(registry.byId(inc.id)?.status).toBe('detected');
  });

  it('reopened incident can be assigned to a second unit after original leaves to refill', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    registry.detectFromFireGrid(grid, 0);
    const inc = registry.list()[0];

    // First assignment + engagement
    registry.markAssigned(inc.id, [10], 1);
    registry.markEngaged(inc.id, 2);

    // Unit 10 left to refill → reopen so a second unit can be dispatched
    registry.reopen(inc.id);
    expect(registry.byId(inc.id)?.status).toBe('detected');

    // Second unit on a road very close to the incident
    const nearPath = makePath(0, 0, 100, 0);
    (nearPath as any).project = (_p: any) => ({ s: 5, dist: 0.5, t: { x: 1, z: 0 } });

    const ref2 = makeFollowerRef(20, nearPath, 0.5, 0.5);

    const loop = createDispatchLoop(registry, { autoDispatch: true, detectInterval: 0 });
    loop.tick(1.0, 3.0, grid, [ref2], [nearPath]);

    expect(ref2.busy).toBe(true);
    expect(registry.byId(inc.id)?.status === 'assigned' || registry.byId(inc.id)?.status === 'engaged').toBe(true);
    expect(registry.byId(inc.id)?.assignedFollowerIds).toContain(20);
  });
});
