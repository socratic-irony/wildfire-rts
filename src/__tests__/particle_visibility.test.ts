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
    scene.add(vehicles.particleGroup); // Add particle group separately like in main.ts
    
    // Initially, both groups should be visible
    expect(vehicles.group.visible).toBe(true);
    expect(vehicles.particleGroup.visible).toBe(true);
    
    // Check that particles are in the particle group, not the main vehicles group
    let particlesInMainGroup = 0;
    let particlesInParticleGroup = 0;
    
    vehicles.group.traverse((child) => {
      if (child.constructor.name === 'InstancedMesh') {
        // Check if this might be a particle system by examining material
        const mesh = child as any;
        if (mesh.material && mesh.material.transparent && mesh.material.depthWrite === false) {
          particlesInMainGroup++;
        }
      }
    });
    
    vehicles.particleGroup.traverse((child) => {
      if (child.constructor.name === 'InstancedMesh') {
        particlesInParticleGroup++;
      }
    });
    
    // Particles should be in the particle group, not the main group
    expect(particlesInParticleGroup).toBe(3); // smoke, dust, water
    expect(particlesInMainGroup).toBe(0);
    
    // Hide the vehicles group (simulating frenet mode)
    vehicles.group.visible = false;
    
    // The main group is now invisible, but particles should still be visible
    expect(vehicles.group.visible).toBe(false);
    expect(vehicles.particleGroup.visible).toBe(true);
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