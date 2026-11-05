import { describe, expect, it } from 'vitest';
import { distance } from '../core/math';
import { GRID_SIZE, tileIndex, tileToWorld } from '../world/constants';
import { Terrain } from '../world/biomes';
import { createHarness, findTileAwayFromRoads, stepFleet } from '../test/harness';
import { BACKBURN_GENERATIONS, FireState, QUERY_WILD } from './fire';
import { IncidentSystem } from './incidents';
import { Scenario } from './scenario';
import { Budget } from './budget';
import { DIFFICULTIES } from './difficulty';
import { IncidentView } from './types';

function incidentView(id: number, tx: number, tz: number): IncidentView {
  const world = tileToWorld(tx, tz);
  return { id, x: world.x, z: world.z, tx, tz, resolved: false };
}

/** A grass/brush/forest tile some distance from roads and water, for test fires. */
function burnableTile(seed: number, minRoadDistance = 6): { x: number; z: number } {
  const { world, fire } = createHarness(seed);
  for (let tz = 10; tz < GRID_SIZE - 10; tz += 2) {
    for (let tx = 10; tx < GRID_SIZE - 10; tx += 2) {
      if (fire.fuelAt(tx, tz).baseROS <= 0) continue;
      if (world.buildings.occupied[tileIndex(tx, tz)]) continue;
      if (world.roads.nearest(tx, tz, minRoadDistance) !== null) continue;
      return { x: tx, z: tz };
    }
  }
  throw new Error('no burnable tile');
}

describe('backburns', () => {
  it('spread under control, then turn wild after the generation budget runs out', () => {
    const { fire } = createHarness(12345, true);
    const start = burnableTile(12345);
    expect(fire.ignite(start.x, start.z, false, BACKBURN_GENERATIONS)).toBe(true);
    expect(fire.isControlled(start.x, start.z)).toBe(true);
    let sawWild = false;
    for (let i = 0; i < 1600 && !sawWild; i += 1) {
      fire.step(0.2);
      sawWild = fire.stats().wildActive > 0;
    }
    expect(fire.stats().backburnHectares + fire.stats().active).toBeGreaterThan(0);
    expect(sawWild).toBe(true);
  });

  it('are invisible to wildfire-only queries and do not count as wildfire burned', () => {
    const { fire } = createHarness(12345, true);
    const start = burnableTile(12345);
    fire.ignite(start.x, start.z, false, BACKBURN_GENERATIONS);
    for (let i = 0; i < 20; i += 1) fire.step(0.2);
    const world = tileToWorld(start.x, start.z);
    expect(fire.nearestActive(world.x, world.z, 6)).not.toBeNull();
    expect(fire.nearestActive(world.x, world.z, 6, QUERY_WILD)).toBeNull();
    expect(fire.stats().wildActive).toBe(0);
    expect(fire.stats().burnedHectares).toBe(0);
  });
});

describe('dozer lines', () => {
  it('a player-drawn line is cut as permanent firebreak and the dozer holds at the end', () => {
    const { world, fire, fleet } = createHarness(12345, true);
    const start = findTileAwayFromRoads(world, 4)!;
    let end: { x: number; z: number } | null = null;
    for (let dx = 10; dx >= 5 && !end; dx -= 1) {
      const candidate = { x: start.x + dx, z: start.z };
      if (fleet.previewLine(start, candidate)) end = candidate;
    }
    expect(end).not.toBeNull();
    const result = fleet.orderLine(null, start, end!);
    expect(result.ok).toBe(true);
    const dozer = fleet.unitById(result.unitId!)!;
    expect(dozer.state).toBe('cutting');
    stepFleet(fleet, 300, 1 / 30, new Map(), () => dozer.state === 'holding');
    expect(dozer.state).toBe('holding');
    const cleared = fire.stats().cleared;
    expect(cleared).toBeGreaterThanOrEqual(5);
    expect(fire.stateAt(start.x, start.z)).toBe(FireState.Cleared);
  });

  it('a dozer stops cutting when the fire reaches the line ahead of the blade', () => {
    const { world, fire, fleet, messages } = createHarness(12345, true);
    const start = findTileAwayFromRoads(world, 4)!;
    let end: { x: number; z: number } | null = null;
    for (let dx = 14; dx >= 8 && !end; dx -= 1) {
      const candidate = { x: start.x + dx, z: start.z };
      if (fleet.previewLine(start, candidate)) end = candidate;
    }
    const result = fleet.orderLine(null, start, end!);
    expect(result.ok).toBe(true);
    const dozer = fleet.unitById(result.unitId!)!;
    stepFleet(fleet, 300, 1 / 30, new Map(), () => dozer.lineTask?.phase === 'cut' && dozer.pathIndex >= 2);
    expect(dozer.lineTask?.phase).toBe('cut');
    const ahead = dozer.path[dozer.pathIndex + 1]!;
    fire.state[tileIndex(ahead.x, ahead.z)] = FireState.Burning;
    stepFleet(fleet, 2, 1 / 30);
    expect(dozer.lineTask).toBeNull();
    expect(dozer.state).toBe('holding');
    expect(messages.some((message) => message.includes('fire reached the line'))).toBe(true);
  });

  it('refuses a line that would run through water or buildings only', () => {
    const { world, fleet } = createHarness(12345);
    let water: { x: number; z: number } | null = null;
    for (let i = 0; i < world.biomes.types.length && !water; i += 1) {
      if (world.biomes.types[i] === Terrain.Water) water = { x: i % GRID_SIZE, z: Math.floor(i / GRID_SIZE) };
    }
    expect(water).not.toBeNull();
    const result = fleet.orderLine(null, water!, water!);
    expect(result.ok).toBe(false);
  });
});

describe('aircraft', () => {
  it('a helicopter dips from the lake when it is closer than the helipad', () => {
    const { world, fire, fleet } = createHarness(12345, true);
    const heli = fleet.units.find((unit) => unit.kind === 'helicopter')!;
    let lakeTile: { x: number; z: number } | null = null;
    for (let i = 0; i < world.biomes.types.length && !lakeTile; i += 1) {
      if (world.biomes.types[i] === Terrain.Water) lakeTile = { x: i % GRID_SIZE, z: Math.floor(i / GRID_SIZE) };
    }
    const lake = tileToWorld(lakeTile!.x, lakeTile!.z);
    // Put a fire just beyond the lake, on the far side from the helipad.
    const away = { x: lake.x - heli.airBaseX, z: lake.z - heli.airBaseZ };
    const length = Math.hypot(away.x, away.z) || 1;
    let target: { x: number; z: number } | null = null;
    for (let d = 14; d < 60 && !target; d += 2) {
      const tx = Math.round((lake.x + (away.x / length) * d) / 2 - 0.5);
      const tz = Math.round((lake.z + (away.z / length) * d) / 2 - 0.5);
      if (tx < 1 || tz < 1 || tx >= GRID_SIZE - 1 || tz >= GRID_SIZE - 1) break;
      if (fire.fuelAt(tx, tz).baseROS > 0 && fire.ignite(tx, tz)) target = { x: tx, z: tz };
    }
    expect(target).not.toBeNull();
    if (!target) return;
    for (let i = 0; i < 6; i += 1) fire.step(0.2);
    const incidents = new Map([[1, incidentView(1, target.x, target.z)]]);
    fleet.assignToIncident(heli.id, incidents.get(1)!);
    let dipped = false;
    stepFleet(fleet, 120, 1 / 30, incidents, () => {
      if (heli.status === 'Dipping at lake') dipped = true;
      return dipped && heli.water >= heli.capacity;
    });
    const nearestLake = fleet.nearestWater(target.x * 2, target.z * 2);
    const lakeCloser =
      nearestLake !== null &&
      distance(target.x * 2, target.z * 2, nearestLake.x, nearestLake.z) <
        distance(target.x * 2, target.z * 2, heli.airBaseX, heli.airBaseZ) * 0.9;
    expect(lakeCloser).toBe(true);
    expect(dipped).toBe(lakeCloser);
    if (lakeCloser) expect(heli.water).toBe(heli.capacity);
  });
});

describe('crew safety', () => {
  it('a dozer left standing in flames suffers a burnover and goes out of service', () => {
    const { fire, fleet, messages } = createHarness(12345, true);
    const dozer = fleet.units.find((unit) => unit.kind === 'dozer')!;
    const tile = burnableTile(12345);
    const world = tileToWorld(tile.x, tile.z);
    dozer.x = world.x;
    dozer.z = world.z;
    fleet.hold(dozer.id);
    fire.ignite(tile.x, tile.z);
    for (let i = 0; i < 5; i += 1) fire.step(0.2);
    for (let t = 0; t < 4 && dozer.outOfService === 0; t += 1 / 30) {
      fire.state[tileIndex(tile.x, tile.z)] = FireState.Burning;
      fire.heat[tileIndex(tile.x, tile.z)] = 1;
      fleet.update(1 / 30, new Map());
    }
    expect(dozer.outOfService).toBeGreaterThan(0);
    expect(messages.some((message) => message.startsWith('Burnover!'))).toBe(true);
    expect(fleet.bestIdle(incidentView(9, tile.x, tile.z), 'dozer')).toBeNull();
  });
});

describe('mutual aid', () => {
  it('arrives as a new unit parked on a free road tile near the station', () => {
    const { world, fleet } = createHarness(12345, true);
    const before = fleet.units.length;
    const added = fleet.addUnit('firetruck');
    expect(fleet.units.length).toBe(before + 1);
    const unit = fleet.unitById(added.id)!;
    expect(unit.mutualAid).toBe(true);
    expect(added.name).toBe('Engine 21');
    expect(world.roads.nearest(Math.floor(unit.x / 2), Math.floor(unit.z / 2), 1)).not.toBeNull();
    for (const other of fleet.units) {
      if (other.id === unit.id || other.kind === 'helicopter' || other.kind === 'tanker') continue;
      expect(distance(other.homeX, other.homeZ, unit.homeX, unit.homeZ)).toBeGreaterThan(1.7);
    }
    expect(fleet.reserveMutualAidName('firetruck')).toBe('Engine 33');
  });
});

describe('incident lookout', () => {
  it('opens an incident for wildfire that nothing is tracking', () => {
    const { fire, fleet } = createHarness(12345, true);
    const incidents = new IncidentSystem(fire, () => undefined);
    incidents.autoDispatch = false;
    const detected: number[] = [];
    incidents.onSpotDetected = (incident) => detected.push(incident.id);
    const tile = burnableTile(12345);
    fire.ignite(tile.x, tile.z);
    for (let i = 0; i < 10; i += 1) fire.step(0.2);
    for (let i = 0; i < 90; i += 1) incidents.update(1 / 30, fleet);
    expect(detected.length).toBe(1);
    expect(incidents.unresolvedCount).toBe(1);
  });
});

describe('scenario forecast and difficulty', () => {
  it('builds a deterministic wind forecast from the seed and preset', () => {
    const a = createHarness(12345, true);
    const b = createHarness(12345, true);
    const scenarioA = new Scenario(a.world, a.fire, new IncidentSystem(a.fire, () => undefined), () => undefined, 12345, 'redflag');
    const scenarioB = new Scenario(b.world, b.fire, new IncidentSystem(b.fire, () => undefined), () => undefined, 12345, 'redflag');
    expect(scenarioA.windForecast).toEqual(scenarioB.windForecast);
    expect(scenarioA.windForecast.length).toBe(DIFFICULTIES.redflag.windShiftTimes.length);
    expect(scenarioA.ignitionsRemaining).toBe(DIFFICULTIES.redflag.ignitionTimes.length);
    expect(a.fire.spreadMultiplier).toBe(DIFFICULTIES.redflag.spreadMultiplier);
    for (const shift of scenarioA.windForecast) {
      expect(shift.speed).toBeGreaterThanOrEqual(DIFFICULTIES.redflag.windSpeedRange[0]);
      expect(shift.speed).toBeLessThanOrEqual(DIFFICULTIES.redflag.windSpeedRange[1]);
    }
  });

  it('announces strikes through the lightning hook and counts down the storm', () => {
    const { world, fire } = createHarness(12345, true);
    const scenario = new Scenario(world, fire, new IncidentSystem(fire, () => undefined), () => undefined, 12345, 'calm');
    const strikes: Array<[number, number]> = [];
    scenario.onLightning = (tx, tz) => strikes.push([tx, tz]);
    scenario.start();
    const first = DIFFICULTIES.calm.ignitionTimes[0]!;
    expect(scenario.nextStrikeIn()).toBeCloseTo(first, 5);
    for (let t = 0; t < first + 1; t += 1 / 30) scenario.update(1 / 30);
    expect(strikes.length).toBe(1);
    expect(fire.stats().active).toBeGreaterThan(0);
  });
});

describe('budget', () => {
  it('accrues income, refuses overspending, and records earnings', () => {
    const budget = new Budget(100, 2);
    budget.update(10);
    expect(budget.funds).toBeCloseTo(120);
    expect(budget.spend(150)).toBe(false);
    expect(budget.spend(120)).toBe(true);
    expect(budget.funds).toBeCloseTo(0);
    budget.earn(50);
    expect(budget.earned).toBe(50);
  });
});

describe('end of shift', () => {
  it('a small fire threatening nothing at the bell counts as corralled, capped at grade B', () => {
    const { world, fire } = createHarness(12345, true);
    const scenario = new Scenario(world, fire, new IncidentSystem(fire, () => undefined), () => undefined, 12345, 'standard');
    scenario.start();
    (scenario as unknown as { ignitionCursor: number }).ignitionCursor = 99;
    const tile = burnableTile(12345, 12);
    fire.ignite(tile.x, tile.z);
    scenario.registerFireStarted();
    for (let i = 0; i < 6; i += 1) fire.step(0.2);
    expect(fire.stats().wildActive).toBeGreaterThan(0);
    expect(fire.stats().wildActive).toBeLessThanOrEqual(15);
    scenario.time = 8 * 60 - 0.01;
    scenario.update(0.05);
    expect(scenario.status).toBe('won');
    expect(scenario.currentResult.reason).toContain('corralled');
    expect(['B', 'C']).toContain(scenario.currentResult.grade);
  });
});
