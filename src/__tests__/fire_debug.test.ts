import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, applyRetardantLine } from '../fire/grid';

// Debug helper to inspect slope calculations
function debugSlope() {
  // Create a simple north-facing slope
  const hm = generateHeightmap(8, 8, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  
  // Manually set heights to create north-facing slope (higher in +Z direction)
  for (let z = 0; z <= 8; z++) {
    for (let x = 0; x <= 8; x++) {
      const i = z * 9 + x;
      hm.data[i] = z * 0.5; // Height increases with Z
    }
  }
  
  const biomes = computeBiomes(hm);
  const grid = buildFireGrid(hm, biomes, { cellSize: 1 });
  
  // Check slope calculation at center
  const centerTile = grid.tiles[4 * 8 + 4]; // z=4, x=4
  console.log('Center tile slope:', {
    slopeTan: centerTile.slopeTan,
    downX: centerTile.downX,
    downZ: centerTile.downZ,
    uphillX: -centerTile.downX,
    uphillZ: -centerTile.downZ
  });
  
  // Test direction calculations
  const nDX = 0, nDZ = 1; // North direction
  const slopeAlign = ((-centerTile.downX) * nDX + (-centerTile.downZ) * nDZ) / 
    (Math.hypot(-centerTile.downX, -centerTile.downZ) * Math.hypot(nDX, nDZ));
  console.log('Slope alignment north:', slopeAlign);
  
  const sDX = 0, sDZ = -1; // South direction
  const slopeAlignSouth = ((-centerTile.downX) * sDX + (-centerTile.downZ) * sDZ) / 
    (Math.hypot(-centerTile.downX, -centerTile.downZ) * Math.hypot(sDX, sDZ));
  console.log('Slope alignment south:', slopeAlignSouth);
}

// Debug helper to inspect rock fuel mechanics
function debugRockBarrier() {
  const hm = generateHeightmap(6, 6, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  const grid = buildFireGrid(hm, biomes, { cellSize: 1 });
  
  // Set middle tiles to rock
  grid.tiles[2 * 6 + 3].fuel = 'rock'; // (3,2)
  grid.tiles[3 * 6 + 3].fuel = 'rock'; // (3,3)
  
  console.log('Rock tile fuel type:', grid.tiles[2 * 6 + 3].fuel);
  console.log('Rock fuel params:', grid.params.fuels.rock);
  
  // Check effective ROS calculation
  const F = grid.params.fuels.rock;
  console.log('Rock baseROS:', F.baseROS, 'fuelLoad:', F.fuelLoad);
}

// Debug helper to inspect retardant application
function debugRetardant() {
  const hm = generateHeightmap(6, 6, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  const grid = buildFireGrid(hm, biomes, { cellSize: 1 });
  
  // Apply retardant at center
  applyRetardantLine(grid, [{ x: 3, z: 3 }], 2, 1.0);
  
  const centerTile = grid.tiles[3 * 6 + 3];
  console.log('Center tile after retardant:', {
    retardant: centerTile.retardant,
    lineStrength: centerTile.lineStrength,
    wetness: centerTile.wetness,
    fuelMoisture: centerTile.fuelMoisture
  });
  
  // Test moisture gating
  const F = grid.params.fuels.grass;
  const fuelMoistEff = centerTile.fuelMoisture + centerTile.wetness + 0.6 * centerTile.retardant;
  const mw = Math.exp(-F.k_m * Math.max(0, Math.min(1, centerTile.wetness + centerTile.fuelMoisture)));
  const mr = Math.exp(-1.2 * Math.max(0, Math.min(1, centerTile.retardant)));
  const moistGate = mw * mr;
  
  console.log('Moisture gating calculation:', {
    fuelMoistEff,
    mw,
    mr, 
    moistGate,
    k_m: F.k_m
  });
}

// Debug helper to inspect barrier factor
function debugBarrierFactor() {
  const lineStrength = 1.0;
  const barrierFactor = Math.max(0, Math.min(1, 1 - lineStrength));
  console.log('Barrier factor with lineStrength=1.0:', barrierFactor);
  
  const lineStrength2 = 0.9;
  const barrierFactor2 = Math.max(0, Math.min(1, 1 - lineStrength2));
  console.log('Barrier factor with lineStrength=0.9:', barrierFactor2);
}

describe('Fire Mechanics Debugging', () => {
  it('should debug slope calculations', () => {
    debugSlope();
    expect(true).toBe(true); // Just to run the debug code
  });
  
  it('should debug rock barrier mechanics', () => {
    debugRockBarrier();
    expect(true).toBe(true);
  });
  
  it('should debug retardant application', () => {
    debugRetardant();
    expect(true).toBe(true);
  });
  
  it('should debug barrier factor calculation', () => {
    debugBarrierFactor();
    expect(true).toBe(true);
  });
});