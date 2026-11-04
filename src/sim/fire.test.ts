import { describe, expect, it } from 'vitest';
import { GRID_SIZE, TILE_SIZE, tileIndex, tileToWorld } from '../world/constants';
import { Heightmap } from '../world/heightmap';
import { BiomeMap, Terrain } from '../world/biomes';
import { FireState, Fuel, Wildfire } from './fire';

function flatWorld(): { map: Heightmap; biomes: BiomeMap } {
  const cells = GRID_SIZE * GRID_SIZE;
  const map = {
    seed: 777,
    size: GRID_SIZE,
    tileSize: TILE_SIZE,
    levelHeight: 2,
    levels: new Uint8Array((GRID_SIZE + 1) * (GRID_SIZE + 1)).fill(3),
    waterMask: new Uint8Array(cells),
    levelAtVertex: () => 3,
    vertexHeight: () => 6,
    heightAt: () => 6,
    cornerHeights: () => [6, 6, 6, 6] as [number, number, number, number],
    tileHeight: () => 6,
    tileMaxHeight: () => 6,
    tileMinHeight: () => 6,
    slopeTan: () => 0,
    isWater: () => false,
    normalAt: () => ({ x: 0, y: 1, z: 0 }),
    isTownVertex: () => false,
  } as unknown as Heightmap;
  const biomes: BiomeMap = {
    types: new Uint8Array(cells).fill(Terrain.Grass),
    moisture: new Float32Array(cells).fill(0.12),
    slope: new Float32Array(cells),
  };
  return { map, biomes };
}

function makeFire(seed = 99): { fire: Wildfire; map: Heightmap; biomes: BiomeMap } {
  const { map, biomes } = flatWorld();
  return { fire: new Wildfire(map, biomes, { seed }), map, biomes };
}

function nonUnburnedCentroidX(fire: Wildfire): number {
  let sum = 0;
  let count = 0;
  for (let tz = 0; tz < GRID_SIZE; tz += 1) {
    for (let tx = 0; tx < GRID_SIZE; tx += 1) {
      const state = fire.state[tileIndex(tx, tz)] ?? 0;
      if (state === FireState.Unburned) continue;
      sum += tx;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

describe('Wildfire', () => {
  it('ignites, spreads, and consumes fuel', () => {
    const { fire } = makeFire();
    expect(fire.ignite(48, 48)).toBe(true);
    for (let i = 0; i < 25; i += 1) fire.step(1);
    const stats = fire.stats();
    expect(stats.burned + stats.active).toBeGreaterThan(1);
    expect(stats.burnedHectares).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for an identical seed and tick sequence', () => {
    const a = makeFire(1234).fire;
    const b = makeFire(1234).fire;
    a.setWind(0.4, 6);
    b.setWind(0.4, 6);
    a.ignite(40, 40);
    b.ignite(40, 40);
    for (let i = 0; i < 30; i += 1) {
      a.step(0.5);
      b.step(0.5);
    }
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
    expect(Array.from(a.heat)).toEqual(Array.from(b.heat));
  });

  it('spreads the burn centroid downwind', () => {
    const east = makeFire(4321).fire;
    const west = makeFire(4321).fire;
    east.setWind(Math.PI / 2, 7);
    west.setWind(-Math.PI / 2, 7);
    east.ignite(48, 48);
    west.ignite(48, 48);
    for (let i = 0; i < 18; i += 1) {
      east.step(1);
      west.step(1);
    }
    expect(nonUnburnedCentroidX(east)).toBeGreaterThan(nonUnburnedCentroidX(west) + 1);
  });

  it('wets and extinguishes a small fire with water', () => {
    const { fire } = makeFire();
    fire.ignite(48, 48);
    for (let i = 0; i < 6; i += 1) fire.step(1);
    const center = tileToWorld(48, 48);
    for (let i = 0; i < 6; i += 1) {
      fire.applyWater(center.x, center.z, 14, 6, 0.5);
      fire.step(0.5);
    }
    expect(fire.wetness[tileIndex(48, 48)] ?? 0).toBeGreaterThan(0.25);
    expect(fire.state[tileIndex(48, 48)]).not.toBe(FireState.Burning);
  });

  it('turns a cut line into an unburnable barrier', () => {
    const { fire } = makeFire();
    const center = tileToWorld(50, 50);
    fire.clearLine(center.x, center.z, 8);
    expect(fire.stateAt(50, 50)).toBe(FireState.Cleared);
    expect(fire.lineStrength[tileIndex(50, 50)]).toBeGreaterThan(0.9);
    expect(fire.ignite(50, 50)).toBe(false);
  });

  it('treats new roads as non-fuel', () => {
    const { fire } = makeFire();
    const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
    mask[tileIndex(30, 30)] = 1;
    fire.refreshRoadMask(mask);
    expect(fire.fuel[tileIndex(30, 30)]).toBe(Fuel.Road);
    expect(fire.ignite(30, 30)).toBe(false);
  });

  it('finds the downwind head of a fire', () => {
    const { fire } = makeFire();
    fire.setWind(Math.PI / 2, 7);
    fire.ignite(40, 48);
    for (let i = 0; i < 12; i += 1) fire.step(1);
    const head = fire.headTileNear(tileToWorld(44, 48).x, tileToWorld(44, 48).z, 30);
    expect(head).not.toBeNull();
    expect(head!.x).toBeGreaterThan(40);
  });
});
