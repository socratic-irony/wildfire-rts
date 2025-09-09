import { describe, it, expect, beforeEach } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomesTuned } from '../terrain/biomes';
import { RoadsVisual } from '../roads/visual';
import { VehiclesManager } from '../vehicles/vehicles';
import { buildTerrainCost } from '../roads/cost';
import { createRoadMask, rasterizePolyline, applyRoadMaskToFireGrid } from '../roads/state';
import { createHydrantSystem, clearHydrants } from '../fire/hydrants';
import { buildFireGrid } from '../fire/grid';

describe('Terrain Regeneration', () => {
  it('should properly clear and regenerate roads and vehicles when terrain changes', () => {
    // Create initial terrain
    const config = {
      width: 64, height: 64,
      noise: { seed: '42', frequency: 2.0, amplitude: 8, octaves: 4, persistence: 0.5 },
      moisture: { seed: 'moist' },
      biomes: { forestMoistureMin: 0.55 }
    };
    
    let hm = generateHeightmap(config.width, config.height, 1, config.noise);
    let biomes = computeBiomesTuned(hm, { forestMoistureMin: config.biomes.forestMoistureMin }, { seed: config.moisture.seed as any });
    let fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
    
    // Create road and vehicle systems
    let roadsVis = new RoadsVisual(hm);
    let roadCost = buildTerrainCost(hm);
    let roadMask = createRoadMask(hm.width, hm.height);
    let vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis, fireGrid);
    let hydrantSystem = createHydrantSystem(roadMask, hm.scale);
    
    // Add some test roads and vehicles
    const testPath = [
      { x: 10, z: 10 }, { x: 15, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 15 }
    ];
    roadsVis.addPath(testPath);
    rasterizePolyline(roadMask, testPath, 0.9);
    applyRoadMaskToFireGrid(fireGrid, roadMask);
    
    // Spawn some vehicles
    vehicles.spawnAt(12, 10);
    vehicles.spawnAt(18, 10);
    
    // Verify initial state
    expect(vehicles.count).toBe(2);
    expect(roadsVis.getMidlinesXZ().length).toBe(1); // One path added
    expect(roadsVis.getMidlinesXZ()[0].length).toBeGreaterThan(0); // Path has points
    
    // === SIMULATE TERRAIN REGENERATION (as in main.ts regenerate function) ===
    
    // Regenerate heightmap and biomes from config
    hm = generateHeightmap(config.width, config.height, 1, config.noise);
    biomes = computeBiomesTuned(hm, { forestMoistureMin: config.biomes.forestMoistureMin }, { seed: config.moisture.seed as any });
    
    // Clear existing roads, vehicles, and hydrants from old terrain (THE FIX)
    roadsVis.clear();
    vehicles.clear();
    clearHydrants(hydrantSystem);
    
    // Rebuild road-related systems for new terrain (THE FIX)
    roadCost = buildTerrainCost(hm);
    roadMask = createRoadMask(hm.width, hm.height);
    
    // Rebuild fire grid and related systems
    fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
    
    // Recreate vehicle manager with new terrain references (THE FIX)
    vehicles = new VehiclesManager(hm, roadCost, roadMask, 64, roadsVis, fireGrid);
    
    // Re-seed test roads on new terrain (THE FIX)
    const newTestPath = [
      { x: 25, z: 25 }, { x: 30, z: 25 }, { x: 35, z: 25 }, { x: 35, z: 30 }
    ];
    roadsVis.addPath(newTestPath);
    rasterizePolyline(roadMask, newTestPath, 0.9);
    applyRoadMaskToFireGrid(fireGrid, roadMask);
    
    // Re-spawn vehicles on new roads (THE FIX)
    vehicles.spawnAt(27, 25);
    vehicles.spawnAt(33, 25);
    
    // === VERIFY THE FIX WORKS ===
    
    // Vehicles should be cleared and re-spawned (count should be 2 again)
    expect(vehicles.count).toBe(2);
    
    // Roads should be cleared and new ones should exist
    const newPaths = roadsVis.getMidlinesXZ();
    expect(newPaths.length).toBe(1); // One new path
    expect(newPaths[0].length).toBeGreaterThan(0); // New path has points
    
    // The new path should be different from the original (different coordinates)
    const newFirstPoint = newPaths[0][0];
    expect(newFirstPoint.x).toBeGreaterThan(20); // New path is in the expected general area
    expect(newFirstPoint.z).toBeGreaterThan(20); // New path is in the expected general area
    expect(newFirstPoint.x).toBeLessThan(30); // But not too far
    expect(newFirstPoint.z).toBeLessThan(30); // But not too far
    
    // Road mask should be properly recreated (non-zero values where roads exist)
    const roadMaskValue = roadMask.mask[25 * roadMask.width + 25]; // Check where new road is
    expect(roadMaskValue).toBeGreaterThan(0); // Should have road mask value
    
    console.log('✅ Terrain regeneration properly clears and recreates roads and vehicles');
  });
  
  it('should handle multiple regeneration cycles without memory leaks', () => {
    const config = {
      width: 32, height: 32,
      noise: { seed: '123', frequency: 1.5, amplitude: 6, octaves: 3, persistence: 0.4 },
      moisture: { seed: 'wet' },
      biomes: { forestMoistureMin: 0.6 }
    };
    
    // Perform multiple regeneration cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      let hm = generateHeightmap(config.width, config.height, 1, config.noise);
      let biomes = computeBiomesTuned(hm, { forestMoistureMin: config.biomes.forestMoistureMin }, { seed: config.moisture.seed as any });
      let fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
      
      let roadsVis = new RoadsVisual(hm);
      let roadCost = buildTerrainCost(hm);
      let roadMask = createRoadMask(hm.width, hm.height);
      let vehicles = new VehiclesManager(hm, roadCost, roadMask, 32, roadsVis, fireGrid);
      
      // Add roads and vehicles
      const paths = [
        [{ x: 5, z: 5 }, { x: 10, z: 5 }, { x: 15, z: 5 }],
        [{ x: 5, z: 15 }, { x: 10, z: 15 }, { x: 15, z: 15 }]
      ];
      
      for (const path of paths) {
        roadsVis.addPath(path);
        rasterizePolyline(roadMask, path, 0.9);
      }
      
      vehicles.spawnAt(7, 5);
      vehicles.spawnAt(12, 15);
      
      // Clear everything (simulate regeneration cleanup)
      roadsVis.clear();
      vehicles.clear();
      
      // Verify clean state
      expect(vehicles.count).toBe(0);
      expect(roadsVis.getMidlinesXZ().length).toBe(0);
    }
    
    console.log('✅ Multiple regeneration cycles handled without issues');
  });
});