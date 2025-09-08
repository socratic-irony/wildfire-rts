import { 
  Group, 
  InstancedMesh, 
  CylinderGeometry, 
  MeshStandardMaterial, 
  Matrix4, 
  Vector3, 
  Color 
} from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { HydrantSystem, FireHydrant } from './hydrants';

export class HydrantVisual {
  public group = new Group();
  private instancedMesh: InstancedMesh;
  private material: MeshStandardMaterial;
  private hm: Heightmap;
  private maxHydrants: number;
  private tempMatrix = new Matrix4();
  private tempVector = new Vector3();

  constructor(hm: Heightmap, maxHydrants = 500) {
    this.hm = hm;
    this.maxHydrants = maxHydrants;

    // Create simple cylindrical hydrant geometry
    const geometry = new CylinderGeometry(0.15, 0.2, 0.5, 8);
    
    // Blue/silver material for active hydrants
    this.material = new MeshStandardMaterial({
      color: 0x4a90e2,
      metalness: 0.7,
      roughness: 0.3,
    });

    this.instancedMesh = new InstancedMesh(geometry, this.material, maxHydrants);
    this.instancedMesh.count = 0; // Start with no instances
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = false;
    
    this.group.add(this.instancedMesh);
  }

  update(system: HydrantSystem): void {
    const hydrants = system.hydrants;
    const count = Math.min(hydrants.length, this.maxHydrants);
    
    // Update instance count
    this.instancedMesh.count = count;
    
    // Update each hydrant instance
    for (let i = 0; i < count; i++) {
      const hydrant = hydrants[i];
      this.updateInstance(i, hydrant);
    }
    
    // Mark instances matrix as needing update
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private updateInstance(index: number, hydrant: FireHydrant): void {
    const wx = hydrant.worldPos.x;
    const wz = hydrant.worldPos.z;
    
    // Get height from heightmap
    const y = this.hm.sample(wx, wz) + 0.25; // Offset to sit on ground
    
    // Set position
    this.tempVector.set(wx, y, wz);
    
    // Create transformation matrix (position only, no rotation needed)
    this.tempMatrix.makeTranslation(this.tempVector.x, this.tempVector.y, this.tempVector.z);
    
    // Apply color based on state
    const color = hydrant.active ? 
      new Color(0x4a90e2) : // Blue for active
      new Color(0xff4444);  // Red for inactive
    
    this.instancedMesh.setMatrixAt(index, this.tempMatrix);
    this.instancedMesh.setColorAt(index, color);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.instancedMesh.geometry.dispose();
    this.material.dispose();
  }

  // Helper to get hydrant at screen position (for debugging/selection)
  getHydrantAt(system: HydrantSystem, worldPos: { x: number; z: number }, threshold = 1.0): FireHydrant | null {
    for (const hydrant of system.hydrants) {
      const dx = hydrant.worldPos.x - worldPos.x;
      const dz = hydrant.worldPos.z - worldPos.z;
      if (Math.sqrt(dx * dx + dz * dz) < threshold) {
        return hydrant;
      }
    }
    return null;
  }
}