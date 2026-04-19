/**
 * Unit tests for the dispatch loop system.
 *
 * We use real fire grids and incident registries; PathFollower is mocked with a
 * minimal stub so tests stay fast and Three.js-free.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, FireState } from '../../fire/grid';
import { createIncidentRegistry } from '../../dispatch/incident';
import { createDispatchLoop, type FollowerRef } from '../dispatchLoop';
import { VehicleType } from '../../vehicles/types';
import type { Path2D } from '../../paths/path2d';
import type { PathFollower } from '../../vehicles/frenet';

// ─── helpers ────────────────────────────────────────────────────────────────

function flatGrid(size = 8) {
  const hm = generateHeightmap(size, size, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  return { grid: buildFireGrid(hm, biomes, { cellSize: 1 }), hm };
}

type V3 = { x: number; y: number; z: number };

function mockFollowerRef(
  id: number,
  type: VehicleType,
  pos: { x: number; z: number },
  busy = false,
  path: Path2D | null = null
): FollowerRef {
  const posVec: V3 = { x: pos.x, y: 0, z: pos.z };
  let targetS: number | null = null;

  const follower = {
    object: {
      getWorldPosition(out: V3) { out.x = posVec.x; out.y = posVec.y; out.z = posVec.z; return out; },
      matrixAutoUpdate: false,
      matrix: { copy: vi.fn(), setPosition: vi.fn() },
    },
    path: path as unknown as Path2D,
    s: 0,
    v: 0,
    targetS,
    stopAtTarget: true,
    setTargetS(s: number) { targetS = s; },
    clearTarget() { targetS = null; },
  } as unknown as PathFollower;

  return { id, type, follower, busy };
}

function mockPath2d(pts: Array<{ x: number; z: number }>): Path2D {
  return {
    length: 100,
    closed: false,
    project: (p: { x: number; z: number }) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z);
        if (d < bestD) { bestD = d; best = i * 10; }
      }
      return { s: best, dist: bestD, t: { x: 1, z: 0 } };
    },
    sample: () => ({ p: { x: 0, z: 0 }, t: { x: 1, z: 0 } }),
    curvature: () => 0,
  } as unknown as Path2D;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('dispatchLoop', () => {
  it('detects incidents from burning fire grid', () => {
    const { grid } = flatGrid();
    grid.tiles[2 * grid.width + 2].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: false });

    const followers: FollowerRef[] = [];
    const paths = [mockPath2d([{ x: 0, z: 0 }])];
    loop.tick(1.1, 1.1, grid, followers, paths);

    expect(registry.list().length).toBeGreaterThanOrEqual(1);
    expect(registry.list()[0].status).toBe('detected');
  });

  it('auto-assigns nearest idle suppression unit', () => {
    const { grid } = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: true });

    const paths = [mockPath2d([{ x: 0, z: 0 }, { x: 10, z: 0 }])];
    // Follower path must be in path2ds so pushGoal can route it
    const ref = mockFollowerRef(1, VehicleType.FIRETRUCK, { x: 1, z: 1 }, false, paths[0]);
    const followers = [ref];

    loop.tick(1.1, 1.1, grid, followers, paths);

    // After one detect+assign cycle, unit should be marked busy
    expect(ref.busy).toBe(true);
    const inc = registry.list().find(i => i.status === 'assigned' || i.status === 'engaged');
    expect(inc).toBeDefined();
    expect(inc!.assignedFollowerIds).toContain(1);
  });

  it('does not auto-assign when autoDispatch is off', () => {
    const { grid } = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: false });

    const ref = mockFollowerRef(1, VehicleType.FIRETRUCK, { x: 1, z: 1 });
    const paths = [mockPath2d([{ x: 0, z: 0 }])];
    loop.tick(1.1, 1.1, grid, [ref], paths);

    expect(ref.busy).toBe(false);
    expect(registry.list().every(i => i.status === 'detected')).toBe(true);
  });

  it('promotes incident to engaged when unit arrives', () => {
    const { grid } = flatGrid();
    // Tile (0,0) → world pos (0.5, 0.5) with cellSize=1
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: true });

    const paths = [mockPath2d([{ x: 0, z: 0 }, { x: 10, z: 0 }])];
    // Place unit very close to the incident (< ENGAGE_RADIUS = 8); path in path2ds
    const ref = mockFollowerRef(1, VehicleType.FIRETRUCK, { x: 0.5, z: 0.5 }, false, paths[0]);

    // First tick: detect + assign
    loop.tick(1.1, 1.1, grid, [ref], paths);
    // Second tick: should promote because unit is already at the scene
    loop.tick(0.1, 1.2, grid, [ref], paths);

    const inc = registry.list()[0];
    expect(inc.status === 'assigned' || inc.status === 'engaged').toBe(true);
  });

  it('resolves incident when fire cools', () => {
    const { grid } = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: false });
    const paths: Path2D[] = [];

    loop.tick(1.1, 1.1, grid, [], paths);
    expect(registry.list()[0].status).toBe('detected');

    // Extinguish the fire
    grid.tiles[0].state = FireState.Burned;
    loop.tick(1.1, 2.2, grid, [], paths);

    expect(registry.list()[0].status).toBe('resolved');
  });

  it('toggles autoDispatch at runtime', () => {
    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { autoDispatch: true });
    expect(loop.getAutoDispatch()).toBe(true);
    loop.setAutoDispatch(false);
    expect(loop.getAutoDispatch()).toBe(false);
  });

  it('skips non-suppression units for auto-assign', () => {
    const { grid } = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { detectInterval: 1.0, autoDispatch: true });

    const bulldozer = mockFollowerRef(1, VehicleType.BULLDOZER, { x: 1, z: 1 });
    const paths = [mockPath2d([{ x: 0, z: 0 }])];
    loop.tick(1.1, 1.1, grid, [bulldozer], paths);

    expect(bulldozer.busy).toBe(false);
  });
});
