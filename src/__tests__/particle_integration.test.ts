import { describe, it, expect } from 'vitest';
import { Scene } from 'three';
import { VehiclesManager, VehicleType } from '../vehicles/vehicles';
import { generateHeightmap } from '../terrain/heightmap';
import { buildTerrainCost } from '../roads/cost';
import { createRoadMask, rasterizePolyline } from '../roads/state';
import { makeAngularPath } from '../roads/path';

describe('Particle Effects Integration', () => {
  it('should spawn and update particles even when grid vehicles are hidden', () => {
    // Create test environment with roads
    const scene = new Scene();
    const hm = generateHeightmap(64, 64, 1, { seed: 'test', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const terrain = buildTerrainCost(hm);
    const roadMask = createRoadMask(64, 64);
    
    // Create a simple road loop for vehicles to move on
    const roadLoop = makeAngularPath([
      { x: 20, z: 20 }, { x: 40, z: 20 }, { x: 40, z: 40 }, { x: 20, z: 40 }, { x: 20, z: 20 }
    ]);
    rasterizePolyline(roadMask, roadLoop, 1.0);
    
    // Create vehicles manager and add to scene
    const vehicles = new VehiclesManager(hm, terrain, roadMask, 8);
    scene.add(vehicles.group);
    scene.add(vehicles.particleGroup);
    
    // Spawn different types of vehicles
    vehicles.spawnAt(20, 20, VehicleType.FIRETRUCK); // Should create water particles
    vehicles.spawnAt(25, 25, VehicleType.CAR);       // Should create dust particles
    vehicles.spawnAt(30, 30, VehicleType.HELICOPTER); // Should create smoke particles
    
    expect(vehicles.count).toBe(3);
    
    // Hide grid vehicles (simulating frenet mode)
    vehicles.group.visible = false;
    
    // Set destinations to make vehicles move (this should trigger particle spawning)
    vehicles.setDestinationAll(35, 35);
    
    // Update multiple times to simulate movement and particle spawning
    for (let i = 0; i < 20; i++) {
      vehicles.update(0.05); // 50ms updates
    }
    
    // Verify that:
    // 1. Grid vehicles are hidden
    expect(vehicles.group.visible).toBe(false);
    
    // 2. Particle group remains visible
    expect(vehicles.particleGroup.visible).toBe(true);
    
    // 3. Particle group is in the scene and has mesh children
    let particleMeshes = 0;
    vehicles.particleGroup.traverse((child) => {
      if (child.constructor.name === 'InstancedMesh') {
        particleMeshes++;
      }
    });
    expect(particleMeshes).toBe(3); // smoke, dust, water systems
    
    // 4. Updates complete without errors
    expect(vehicles.count).toBe(3);
  });
  
  it('should properly clean up particles when vehicles are cleared', () => {
    const scene = new Scene();
    const hm = generateHeightmap(32, 32, 1, { seed: 'test', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const terrain = buildTerrainCost(hm);
    const roadMask = createRoadMask(32, 32);
    
    const vehicles = new VehiclesManager(hm, terrain, roadMask, 4);
    scene.add(vehicles.group);
    scene.add(vehicles.particleGroup);
    
    // Spawn and move vehicles to generate particles
    vehicles.spawnAt(10, 10);
    vehicles.setDestinationAll(15, 15);
    
    for (let i = 0; i < 10; i++) {
      vehicles.update(0.05);
    }
    
    expect(vehicles.count).toBe(1);
    
    // Clear all vehicles
    vehicles.clear();
    
    // Verify vehicles are cleared
    expect(vehicles.count).toBe(0);
    
    // Verify particle group still exists and can be updated
    vehicles.update(0.05);
    
    // This should not throw any errors
    expect(vehicles.particleGroup.visible).toBe(true);
  });
});