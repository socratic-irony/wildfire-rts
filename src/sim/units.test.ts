import { describe, expect, it } from 'vitest';
import { distance } from '../core/math';
import { tileToWorld, worldToTile } from '../world/constants';
import { createHarness, findTileAwayFromRoads, stepFleet } from '../test/harness';

function farRoadTile(seed: number): { x: number; z: number } {
  const { world } = createHarness(seed);
  const station = world.stationRoad;
  let best = { x: station.x, z: station.z };
  let bestDistance = 0;
  world.roads.forEach((tx, tz) => {
    const d = Math.hypot(tx - station.x, tz - station.z);
    if (d > bestDistance && d < 40 && world.roads.findPath({ x: station.x, z: station.z }, { x: tx, z: tz })) {
      best = { x: tx, z: tz };
      bestDistance = d;
    }
  });
  return best;
}

describe('fleet ground movement', () => {
  for (const dt of [1 / 60, 0.05, 0.2]) {
    it(`engine completes a road move and returns home at dt=${dt.toFixed(3)}`, () => {
      const { fleet } = createHarness(12345);
      const engine = fleet.unitById(1)!;
      const target = farRoadTile(12345);
      const world = tileToWorld(target.x, target.z);
      expect(fleet.orderMove(engine.id, world.x, world.z).ok).toBe(true);
      stepFleet(fleet, 90, dt, new Map(), () => engine.state === 'holding');
      expect(engine.state).toBe('holding');
      expect(distance(engine.x, engine.z, world.x, world.z)).toBeLessThan(1.5);

      fleet.returnHome(engine.id);
      stepFleet(fleet, 90, dt, new Map(), () => engine.state === 'idle' && distance(engine.x, engine.z, engine.homeX, engine.homeZ) < 0.2);
      expect(engine.state).toBe('idle');
      expect(distance(engine.x, engine.z, engine.homeX, engine.homeZ)).toBeLessThan(0.2);
    });
  }

  it('dozer stranded far from any road drives home off-road and becomes idle', () => {
    const { world, fleet } = createHarness(12345);
    const dozer = fleet.units.find((unit) => unit.kind === 'dozer')!;
    const remote = findTileAwayFromRoads(world, 10);
    expect(remote).not.toBeNull();
    const start = tileToWorld(remote!.x, remote!.z);
    dozer.x = start.x;
    dozer.z = start.z;
    fleet.returnHome(dozer.id);
    expect(dozer.state).toBe('returning');
    stepFleet(fleet, 240, 0.05, new Map(), () => dozer.state === 'idle');
    expect(dozer.state).toBe('idle');
    const home = worldToTile(dozer.homeX, dozer.homeZ);
    const here = worldToTile(dozer.x, dozer.z);
    expect(Math.hypot(home.x - here.x, home.z - here.z)).toBeLessThanOrEqual(2);
  });

  it('a unit with no tank never enters the refilling state', () => {
    const { fleet } = createHarness(12345);
    const dozer = fleet.units.find((unit) => unit.kind === 'dozer')!;
    dozer.state = 'refilling';
    dozer.refillMode = 'base';
    stepFleet(fleet, 1, 0.05);
    expect(dozer.state).not.toBe('refilling');
  });
});
