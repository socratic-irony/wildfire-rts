import { World } from '../world/world';
import { Wildfire } from '../sim/fire';
import { ParticleSystem } from '../sim/particles';
import { Fleet } from '../sim/units';
import { IncidentView } from '../sim/types';
import { GRID_SIZE, tileIndex } from '../world/constants';

export interface Harness {
  world: World;
  fire: Wildfire;
  fleet: Fleet;
  messages: string[];
}

const worlds = new Map<number, World>();

/** Headless world + fire + fleet. Worlds are cached per seed; fleets are fresh. */
export function createHarness(seed = 12345, freshWorld = false): Harness {
  let world = freshWorld ? undefined : worlds.get(seed);
  if (!world) {
    world = new World(seed);
    if (!freshWorld) worlds.set(seed, world);
  }
  const fire = new Wildfire(world.heightmap, world.biomes, {
    roadMask: world.roads.mask,
    structureAt: world.buildings.structureAt,
    seed,
  });
  const particles = new ParticleSystem(world.heightmap);
  const messages: string[] = [];
  const fleet = new Fleet(world, fire, particles, (message) => messages.push(message));
  return { world, fire, fleet, messages };
}

export function stepFleet(
  fleet: Fleet,
  seconds: number,
  dt: number,
  incidents: Map<number, IncidentView> = new Map(),
  until?: () => boolean,
): number {
  let elapsed = 0;
  while (elapsed < seconds) {
    fleet.update(dt, incidents);
    elapsed += dt;
    if (until?.()) break;
  }
  return elapsed;
}

/** A tile at least `minRoadDistance` tiles from any road, on dry, unbuilt ground. */
export function findTileAwayFromRoads(world: World, minRoadDistance: number): { x: number; z: number } | null {
  for (let tz = 6; tz < GRID_SIZE - 6; tz += 3) {
    for (let tx = 6; tx < GRID_SIZE - 6; tx += 3) {
      if (world.heightmap.isWater(tx, tz)) continue;
      if (world.buildings.occupied[tileIndex(tx, tz)]) continue;
      if (world.roads.nearest(tx, tz, minRoadDistance) !== null) continue;
      return { x: tx, z: tz };
    }
  }
  return null;
}
