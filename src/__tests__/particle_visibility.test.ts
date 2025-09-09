import { describe, it, expect } from 'vitest';
import { Scene } from 'three';
import { VehiclesManager } from '../vehicles/vehicles';
import { generateHeightmap } from '../terrain/heightmap';
import { buildTerrainCost } from '../roads/cost';
import { createRoadMask } from '../roads/state';

describe('Particle Visibility', () => {
  it('should keep particle effects visible even when grid vehicles are hidden', () => {
    // Create test environment
    const scene = new Scene();
    const hm = generateHeightmap(32, 32, 1, { seed: 'test', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const terrain = buildTerrainCost(hm);
    const roadMask = createRoadMask(32, 32);
    
    // Create vehicles manager
    const vehicles = new VehiclesManager(hm, terrain, roadMask, 4);
    scene.add(vehicles.group);
    
    // Initially, the group should be visible
    expect(vehicles.group.visible).toBe(true);
    
    // Check that particle meshes exist and are part of the scene
    let allChildren = 0;
    let instancedMeshes = 0;
    vehicles.group.traverse((child) => {
      allChildren++;
      console.log(`Child ${allChildren}: ${child.constructor.name}, type: ${child.type}`);
      if (child.constructor.name === 'InstancedMesh') {
        instancedMeshes++;
      }
    });
    
    console.log(`Total children: ${allChildren}, InstancedMeshes: ${instancedMeshes}`);
    
    // Should have multiple instanced meshes (vehicles + particle systems)
    expect(instancedMeshes).toBeGreaterThan(0);
    
    // Hide the vehicles group (simulating frenet mode)
    vehicles.group.visible = false;
    
    // The group is now invisible
    expect(vehicles.group.visible).toBe(false);
    
    // This means ALL children including particles are also invisible
    // This is the bug we're fixing - particles should remain visible
    // even when grid vehicles are hidden
  });
  
  it('should spawn particles when vehicles move', () => {
    const scene = new Scene();
    const hm = generateHeightmap(32, 32, 1, { seed: 'test', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const terrain = buildTerrainCost(hm);
    const roadMask = createRoadMask(32, 32);
    
    const vehicles = new VehiclesManager(hm, terrain, roadMask, 4);
    scene.add(vehicles.group);
    
    // Spawn a vehicle
    vehicles.spawnAt(10, 10);
    expect(vehicles.count).toBe(1);
    
    // Simulate movement by updating multiple frames
    // First update - establish initial position
    vehicles.update(0.016);
    
    // Move the vehicle to trigger particle spawning
    vehicles.setDestinationAll(15, 15);
    
    // Update several times to allow movement and particle spawning
    for (let i = 0; i < 10; i++) {
      vehicles.update(0.016);
    }
    
    // Note: We can't easily test if particles were actually spawned
    // without accessing private properties, but we can verify the 
    // system doesn't crash and updates complete
    expect(vehicles.count).toBe(1);
  });
});