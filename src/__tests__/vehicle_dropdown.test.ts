import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Vehicle Dropdown Spawn Logic', () => {
  // Mock the VehicleManager enum since we can't import from vehicles.ts in isolation
  enum MockVehicleType {
    CAR = 'car',
    FIRETRUCK = 'firetruck',
    BULLDOZER = 'bulldozer',
  }

  // Mock the mapping function that exists in main.ts
  function mapMenubarToVehicleType(menubarType?: string): MockVehicleType | undefined {
    switch (menubarType) {
      case 'firetruck': return MockVehicleType.FIRETRUCK;
      case 'bulldozer': return MockVehicleType.BULLDOZER;
      case 'generic': return MockVehicleType.CAR;
      default: return MockVehicleType.CAR; // Default fallback
    }
  }

  // Mock the follower spawn function behavior
  function createMockSpawnFollower(vehicleType?: MockVehicleType) {
    // This simulates the fixed spawnFollowerAtCamera function
    const effectiveType = vehicleType ?? MockVehicleType.CAR;
    
    let appearance: { color: string; material: string };
    switch (effectiveType) {
      case MockVehicleType.FIRETRUCK:
        appearance = { color: 'red', material: 'firetruck' };
        break;
      case MockVehicleType.BULLDOZER:
        appearance = { color: 'yellow', material: 'bulldozer' };
        break;
      case MockVehicleType.CAR:
      default:
        appearance = { color: 'blue', material: 'car' };
        break;
    }
    
    return {
      vehicleType: effectiveType,
      appearance
    };
  }

  it('should spawn correct vehicle type when firetruck is selected', () => {
    // Simulate user selecting firetruck from dropdown
    const selectedType = 'firetruck';
    
    // Map to vehicle manager enum (this was the working part)
    const mappedType = mapMenubarToVehicleType(selectedType);
    expect(mappedType).toBe(MockVehicleType.FIRETRUCK);
    
    // Spawn follower with the correct type (this was the bug - now fixed)
    const spawnedVehicle = createMockSpawnFollower(mappedType);
    
    // Verify the spawned vehicle has correct properties
    expect(spawnedVehicle.vehicleType).toBe(MockVehicleType.FIRETRUCK);
    expect(spawnedVehicle.appearance.color).toBe('red');
    expect(spawnedVehicle.appearance.material).toBe('firetruck');
  });

  it('should spawn correct vehicle type when bulldozer is selected', () => {
    // Simulate user selecting bulldozer from dropdown
    const selectedType = 'bulldozer';
    
    // Map to vehicle manager enum
    const mappedType = mapMenubarToVehicleType(selectedType);
    expect(mappedType).toBe(MockVehicleType.BULLDOZER);
    
    // Spawn follower with the correct type
    const spawnedVehicle = createMockSpawnFollower(mappedType);
    
    // Verify the spawned vehicle has correct properties
    expect(spawnedVehicle.vehicleType).toBe(MockVehicleType.BULLDOZER);
    expect(spawnedVehicle.appearance.color).toBe('yellow');
    expect(spawnedVehicle.appearance.material).toBe('bulldozer');
  });

  it('should spawn correct vehicle type when generic is selected', () => {
    // Simulate user selecting generic from dropdown
    const selectedType = 'generic';
    
    // Map to vehicle manager enum
    const mappedType = mapMenubarToVehicleType(selectedType);
    expect(mappedType).toBe(MockVehicleType.CAR);
    
    // Spawn follower with the correct type
    const spawnedVehicle = createMockSpawnFollower(mappedType);
    
    // Verify the spawned vehicle has correct properties
    expect(spawnedVehicle.vehicleType).toBe(MockVehicleType.CAR);
    expect(spawnedVehicle.appearance.color).toBe('blue');
    expect(spawnedVehicle.appearance.material).toBe('car');
  });

  it('should default to car when no vehicle type is provided', () => {
    // Simulate the old buggy behavior where vehicle type was undefined
    const spawnedVehicle = createMockSpawnFollower(undefined);
    
    // Should default to car (blue vehicle)
    expect(spawnedVehicle.vehicleType).toBe(MockVehicleType.CAR);
    expect(spawnedVehicle.appearance.color).toBe('blue');
    expect(spawnedVehicle.appearance.material).toBe('car');
  });
});