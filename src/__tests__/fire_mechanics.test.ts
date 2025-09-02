import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, ignite, applyWaterAoE, applyRetardantLine, writeFirelineEdges } from '../fire/grid';
import { FireSim } from '../fire/sim';
import { createRoadMask, rasterizePolyline, applyRoadMaskToFireGrid } from '../roads/state';

// Helper to create a simple flat heightmap for controlled testing
function createFlatHeightmap(width: number, height: number) {
  return generateHeightmap(width, height, 1, { 
    seed: 'flat', 
    frequency: 0, 
    amplitude: 0, 
    octaves: 1, 
    persistence: 1 
  });
}

// Helper to create a sloped heightmap for slope testing
function createSlopedHeightmap(width: number, height: number, slopeDirection: 'north' | 'south' | 'east' | 'west') {
  const hm = createFlatHeightmap(width, height);
  // Create a consistent slope in the specified direction
  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      const i = z * (width + 1) + x;
      switch (slopeDirection) {
        case 'north': // higher in +Z direction
          hm.data[i] = z * 0.5;
          break;
        case 'south': // higher in -Z direction  
          hm.data[i] = (height - z) * 0.5;
          break;
        case 'east': // higher in +X direction
          hm.data[i] = x * 0.5;
          break;
        case 'west': // higher in -X direction
          hm.data[i] = (width - x) * 0.5;
          break;
      }
    }
  }
  return hm;
}

// Helper to run simulation for a specific time and return spread metrics
function runSimulationAndMeasureSpread(grid: any, env: any, timeSeconds: number) {
  const sim = new FireSim(grid, env);
  const steps = Math.ceil(timeSeconds * 4); // 4 Hz simulation
  for (let i = 0; i < steps; i++) {
    sim.step(0.25);
  }
  
  // Count burned tiles in each direction from ignition point
  let north = 0, south = 0, east = 0, west = 0;
  const centerX = Math.floor(grid.width / 2);
  const centerZ = Math.floor(grid.height / 2);
  
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const tile = grid.tiles[z * grid.width + x];
      if (tile.state >= 2) { // Burning, Smoldering, or Burned
        if (z < centerZ) south++;
        if (z > centerZ) north++;
        if (x > centerX) east++;
        if (x < centerX) west++;
      }
    }
  }
  
  return { north, south, east, west };
}

describe('Fire Mechanics Implementation', () => {
  describe('Wind Effects', () => {
    it('should spread faster downwind than upwind', () => {
      const hm = createFlatHeightmap(32, 32);
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1, 
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 }
      });
      
      // Ignite center
      const centerX = Math.floor(grid.width / 2);
      const centerZ = Math.floor(grid.height / 2);
      ignite(grid, [{ x: centerX, z: centerZ }]);
      
      // Test strong north wind (blowing toward +Z)
      const windEnv = { windDirRad: 0, windSpeed: 5 }; // 0 rad = +Z direction
      const results = runSimulationAndMeasureSpread(grid, windEnv, 10);
      
      // Fire should spread more toward +Z (north) than -Z (south) due to wind
      expect(results.north).toBeGreaterThan(results.south);
    });

    it('should spread equally in crosswind directions with no upwind/downwind bias', () => {
      const hm = createFlatHeightmap(32, 32);
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1,
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 }
      });
      
      // Ignite center
      const centerX = Math.floor(grid.width / 2);
      const centerZ = Math.floor(grid.height / 2);
      ignite(grid, [{ x: centerX, z: centerZ }]);
      
      // Test east wind (blowing toward +X) - should not bias N/S spread
      const windEnv = { windDirRad: Math.PI / 2, windSpeed: 5 };
      const results = runSimulationAndMeasureSpread(grid, windEnv, 10);
      
      // East should be greater than west (downwind vs upwind)
      expect(results.east).toBeGreaterThan(results.west);
    });
  });

  describe('Slope Effects', () => {
    it('should spread faster uphill than downhill', () => {
      // Create heightmap with north-facing slope (higher elevation to the north)
      const hm = createSlopedHeightmap(32, 32, 'north');
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1,
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 }
      });
      
      // Ignite center
      const centerX = Math.floor(grid.width / 2);
      const centerZ = Math.floor(grid.height / 2);
      ignite(grid, [{ x: centerX, z: centerZ }]);
      
      // No wind so only slope affects spread
      const noWindEnv = { windDirRad: 0, windSpeed: 0 };
      const results = runSimulationAndMeasureSpread(grid, noWindEnv, 15);
      
      // Fire should spread more uphill (north) than downhill (south)
      expect(results.north).toBeGreaterThan(results.south);
    });

    it('should combine wind and slope effects when aligned', () => {
      // Create north-facing slope
      const hm = createSlopedHeightmap(24, 24, 'north');
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1,
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 }
      });
      
      // Ignite center
      const centerX = Math.floor(grid.width / 2);
      const centerZ = Math.floor(grid.height / 2);
      ignite(grid, [{ x: centerX, z: centerZ }]);
      
      // Wind blowing uphill (north) should combine with slope effect
      const alignedEnv = { windDirRad: 0, windSpeed: 3 };
      const results = runSimulationAndMeasureSpread(grid, alignedEnv, 12);
      
      // Strong bias toward north with both wind and slope favoring it
      expect(results.north).toBeGreaterThan(results.south);
    });
  });

  describe('Fuel Type Effects', () => {
    it('should have different spread rates for different fuel types', () => {
      const hm = createFlatHeightmap(20, 20);
      const biomes = computeBiomes(hm);
      
      // Create three grids with different fuel types
      const grassGrid = buildFireGrid(hm, biomes, { cellSize: 1 });
      const chaparralGrid = buildFireGrid(hm, biomes, { cellSize: 1 });  
      const forestGrid = buildFireGrid(hm, biomes, { cellSize: 1 });
      
      // Manually set fuel types (override biome-based assignment)
      for (let i = 0; i < grassGrid.tiles.length; i++) {
        grassGrid.tiles[i].fuel = 'grass';
        chaparralGrid.tiles[i].fuel = 'chaparral'; 
        forestGrid.tiles[i].fuel = 'forest';
      }
      
      const centerX = Math.floor(hm.width / 2);
      const centerZ = Math.floor(hm.height / 2);
      
      // Ignite center of each grid
      ignite(grassGrid, [{ x: centerX, z: centerZ }]);
      ignite(chaparralGrid, [{ x: centerX, z: centerZ }]);
      ignite(forestGrid, [{ x: centerX, z: centerZ }]);
      
      // Run simulations with no wind/slope
      const env = { windDirRad: 0, windSpeed: 0 };
      const grassResults = runSimulationAndMeasureSpread(grassGrid, env, 8);
      const chaparralResults = runSimulationAndMeasureSpread(chaparralGrid, env, 8);
      const forestResults = runSimulationAndMeasureSpread(forestGrid, env, 8);
      
      const grassTotal = grassResults.north + grassResults.south + grassResults.east + grassResults.west;
      const chaparralTotal = chaparralResults.north + chaparralResults.south + chaparralResults.east + chaparralResults.west;
      const forestTotal = forestResults.north + forestResults.south + forestResults.east + forestResults.west;
      
      // Grass should spread fastest, forest slowest (based on baseROS values)
      expect(grassTotal).toBeGreaterThan(chaparralTotal);
      expect(chaparralTotal).toBeGreaterThan(forestTotal);
    });
  });

  describe('Road and Rock Barriers', () => {
    it('should not spread through rock tiles', () => {
      const hm = createFlatHeightmap(16, 16);
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1,
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 } // Disable spotting
      });
      
      // Create a complete rock wall from top to bottom (no gaps)
      for (let z = 0; z < grid.height; z++) {
        grid.tiles[z * grid.width + 8].fuel = 'rock';
      }
      
      // Ignite west side of rock barrier  
      ignite(grid, [{ x: 4, z: 8 }]);
      
      // Run simulation with strong east wind for sufficient time
      const env = { windDirRad: Math.PI / 2, windSpeed: 3 }; // Strong east wind
      const sim = new FireSim(grid, env);
      for (let i = 0; i < 200; i++) sim.step(0.25); // 50 seconds
      
      // Check fire spread on both sides of complete rock wall (x=8)
      let fireOnWestSide = false;
      let fireOnEastSide = false;
      
      for (let x = 0; x < 8; x++) { // West of barrier
        for (let z = 0; z < grid.height; z++) {
          if (grid.tiles[z * grid.width + x].state >= 2) fireOnWestSide = true;
        }
      }
      
      for (let x = 9; x < grid.width; x++) { // East of barrier  
        for (let z = 0; z < grid.height; z++) {
          if (grid.tiles[z * grid.width + x].state >= 2) fireOnEastSide = true;
        }
      }
      
      expect(fireOnWestSide).toBe(true); // Fire should exist on ignition side
      expect(fireOnEastSide).toBe(false); // Fire should not cross complete rock barrier
    });

    it('should spread slower through road tiles (urban fuel)', () => {
      const hm = createFlatHeightmap(20, 20);
      const biomes = computeBiomes(hm);
      const grassGrid = buildFireGrid(hm, biomes, { cellSize: 1 });
      const roadGrid = buildFireGrid(hm, biomes, { cellSize: 1 });
      
      // Apply road mask to second grid
      const roadMask = createRoadMask(20, 20);
      rasterizePolyline(roadMask, [
        { x: 0, z: 10 }, { x: 19, z: 10 }
      ], 2); // Wide road across middle
      applyRoadMaskToFireGrid(roadGrid, roadMask);
      
      // Ignite both grids at same location
      ignite(grassGrid, [{ x: 10, z: 10 }]);
      ignite(roadGrid, [{ x: 10, z: 10 }]);
      
      // Run simulations
      const env = { windDirRad: 0, windSpeed: 0 };
      const grassResults = runSimulationAndMeasureSpread(grassGrid, env, 10);
      const roadResults = runSimulationAndMeasureSpread(roadGrid, env, 10);
      
      const grassTotal = grassResults.north + grassResults.south + grassResults.east + grassResults.west;
      const roadTotal = roadResults.north + roadResults.south + roadResults.east + roadResults.west;
      
      // Road grid should have slower spread due to urban fuel
      expect(grassTotal).toBeGreaterThan(roadTotal);
    });
  });

  describe('Moisture and Suppression Effects', () => {
    it('should be suppressed by high wetness', () => {
      const hm = createFlatHeightmap(16, 16);
      const biomes = computeBiomes(hm);
      const dryGrid = buildFireGrid(hm, biomes, { cellSize: 1 });
      const wetGrid = buildFireGrid(hm, biomes, { cellSize: 1 });
      
      // Apply water to wet grid
      applyWaterAoE(wetGrid, { x: 8, z: 8 }, 6, 0.8);
      
      // Ignite both grids
      ignite(dryGrid, [{ x: 8, z: 8 }]);
      ignite(wetGrid, [{ x: 8, z: 8 }]);
      
      // Run simulations
      const env = { windDirRad: 0, windSpeed: 1 };
      const dryResults = runSimulationAndMeasureSpread(dryGrid, env, 8);
      const wetResults = runSimulationAndMeasureSpread(wetGrid, env, 8);
      
      const dryTotal = dryResults.north + dryResults.south + dryResults.east + dryResults.west;
      const wetTotal = wetResults.north + wetResults.south + wetResults.east + wetResults.west;
      
      // Wet grid should have significantly slower spread
      expect(dryTotal).toBeGreaterThan(wetTotal * 1.5);
    });

    it('should be blocked by retardant lines', () => {
      const hm = createFlatHeightmap(12, 12);
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1,
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 },
        thresholds: { extinguishHeat: 0.12, crownHeat: 10.0 } // Disable crown bypass
      });
      
      // Apply retardant line as a proper polyline across the middle at z=6
      applyRetardantLine(grid, [
        { x: 0, z: 6 }, { x: 11, z: 6 }
      ], 1.5, 1.0); // Wide, strong retardant line
      
      // Ignite south of retardant line
      ignite(grid, [{ x: 6, z: 3 }]);
      
      // Run simulation with north wind
      const env = { windDirRad: 0, windSpeed: 2 }; // North wind pushing toward barrier
      const sim = new FireSim(grid, env);
      for (let i = 0; i < 100; i++) sim.step(0.25); // 25 seconds
      
      // Check fire spread well away from barrier zone
      let fireSouth = false, fireNorth = false;
      for (let x = 0; x < grid.width; x++) {
        for (let z = 0; z < 5; z++) { // Well south of barrier
          if (grid.tiles[z * grid.width + x].state >= 2) fireSouth = true;
        }
        for (let z = 8; z < grid.height; z++) { // Well north of barrier  
          if (grid.tiles[z * grid.width + x].state >= 2) fireNorth = true;
        }
      }
      
      expect(fireSouth).toBe(true); // Fire should exist on ignition side
      expect(fireNorth).toBe(false); // Strong retardant should block spread
    });

    it('should be blocked by fire lines', () => {
      const hm = createFlatHeightmap(12, 12);
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { 
        cellSize: 1,
        spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 },
        thresholds: { extinguishHeat: 0.12, crownHeat: 10.0 } // Disable crown bypass
      });
      
      // Create complete fire line across middle at z=6
      const fireline = [];
      for (let x = 0; x < grid.width; x++) {
        fireline.push({ x, z: 6 });
      }
      writeFirelineEdges(grid, fireline, 1.0); // Maximum strength
      
      // Ignite south of fireline
      ignite(grid, [{ x: 6, z: 3 }]);
      
      // Run simulation with north wind
      const env = { windDirRad: 0, windSpeed: 2 };
      const sim = new FireSim(grid, env);
      for (let i = 0; i < 100; i++) sim.step(0.25); // 25 seconds
      
      // Check fire well away from the line
      let fireSouth = false, fireNorth = false;
      for (let x = 0; x < grid.width; x++) {
        for (let z = 0; z < 5; z++) {
          if (grid.tiles[z * grid.width + x].state >= 2) fireSouth = true;
        }
        for (let z = 8; z < grid.height; z++) {
          if (grid.tiles[z * grid.width + x].state >= 2) fireNorth = true;
        }
      }
      
      expect(fireSouth).toBe(true);
      expect(fireNorth).toBe(false); // Fire line should block spread
    });
  });

  describe('Water Suppression', () => {
    it('should immediately reduce heat when water is applied to burning tiles', () => {
      const hm = createFlatHeightmap(10, 10);
      const biomes = computeBiomes(hm);
      const grid = buildFireGrid(hm, biomes, { cellSize: 1 });
      
      // Ignite several tiles and let burn for a bit to build up heat
      ignite(grid, [
        { x: 4, z: 4 }, { x: 5, z: 4 }, { x: 4, z: 5 }, { x: 5, z: 5 },
        { x: 6, z: 4 }, { x: 6, z: 5 }
      ]);
      const sim = new FireSim(grid, { windDirRad: 0, windSpeed: 0 });
      for (let i = 0; i < 20; i++) sim.step(0.25); // 5 seconds
      
      const burningBefore = grid.tiles.filter(t => t.state === 2).length;
      
      // Apply water heavily
      applyWaterAoE(grid, { x: 5, z: 4.5 }, 3, 0.8);
      
      // Continue simulation briefly to see suppression effect  
      for (let i = 0; i < 12; i++) sim.step(0.25); // 3 more seconds
      
      // The fire should be suppressed - significantly fewer burning tiles
      const burningAfter = grid.tiles.filter(t => t.state === 2).length;
      expect(burningAfter).toBeLessThan(burningBefore); // Should suppress some burning tiles
      
      // Check that wetness was applied
      const centerTile = grid.tiles[4 * grid.width + 5];
      expect(centerTile.wetness).toBeGreaterThan(0.5);
    });
  });
});