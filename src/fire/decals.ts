import { Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from 'three';
import { Heightmap } from '../terrain/heightmap';
import { FireGrid, indexToCoord } from './grid';

export function createWaterDecals(hm: Heightmap, opts?: { offsetY?: number; depthTest?: boolean; renderOrder?: number }) {
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2); // Make it horizontal
  
  const mat = new MeshBasicMaterial({ 
    color: new Color('#87CEEB'), // Light blue (SkyBlue)
    transparent: true, 
    opacity: 0.6, 
    depthWrite: false,
    side: DoubleSide, // DoubleSide
    vertexColors: false
  });
  
  if (opts && typeof opts.depthTest === 'boolean') mat.depthTest = opts.depthTest;
  
  // Preallocate capacity for all grid tiles
  const capacity = hm.width * hm.height;
  const inst = new InstancedMesh(plane, mat, capacity);
  (inst as any).count = 0;
  inst.frustumCulled = false;
  if (opts?.renderOrder !== undefined) inst.renderOrder = opts.renderOrder;
  
  // Enable instance colors (required for setColorAt to work)
  inst.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);

  const tmp = new Object3D();
  const m = new Matrix4();
  
  let yOffset = opts?.offsetY ?? 0.08;

  const update = (grid: FireGrid) => {
    let idx = 0;
    const half = hm.scale * 0.5;
    const baseScale = hm.scale * 0.8; // Slightly smaller than full tile

    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        const i = z * grid.width + x;
        const tile = grid.tiles[i];
        
        // Only render if tile has significant wetness
        if (tile.wetness > 0.05) {
          const wx = x * hm.scale + half;
          const wz = z * hm.scale + half;
          const wy = hm.sample(wx, wz) + yOffset;
          
          // Scale and opacity based on wetness level
          const intensity = Math.min(tile.wetness, 1.0);
          const scale = baseScale * (0.6 + intensity * 0.4); // Scale from 60% to 100% of base
          
          tmp.position.set(wx, wy, wz);
          tmp.scale.set(scale, 1, scale);
          tmp.rotation.set(0, 0, 0);
          tmp.updateMatrix();
          m.copy(tmp.matrix);
          inst.setMatrixAt(idx++, m);
          
          // Color intensity based on wetness level
          const col = new Color('#87CEEB');
          col.multiplyScalar(0.7 + intensity * 0.3); // Brighten with more wetness
          inst.setColorAt(idx - 1, col);
        }
      }
    }

    (inst as any).count = idx;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  };

  const setOffsetY = (y: number) => { yOffset = y; };
  const setDepthTest = (on: boolean) => { (inst.material as MeshBasicMaterial).depthTest = on; };
  
  return { inst, update, setOffsetY, setDepthTest } as const;
}

export function createRetardantDecals(hm: Heightmap, opts?: { offsetY?: number; depthTest?: boolean; renderOrder?: number }) {
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2); // Make it horizontal
  
  const mat = new MeshBasicMaterial({ 
    color: new Color('#8B0000'), // Dark red (DarkRed)  
    transparent: true, 
    opacity: 0.7, 
    depthWrite: false,
    side: DoubleSide, // DoubleSide
    vertexColors: false
  });
  
  if (opts && typeof opts.depthTest === 'boolean') mat.depthTest = opts.depthTest;
  
  // Preallocate capacity for all grid tiles
  const capacity = hm.width * hm.height;
  const inst = new InstancedMesh(plane, mat, capacity);
  (inst as any).count = 0;
  inst.frustumCulled = false;
  if (opts?.renderOrder !== undefined) inst.renderOrder = opts.renderOrder;
  
  // Enable instance colors (required for setColorAt to work)
  inst.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);

  const tmp = new Object3D();
  const m = new Matrix4();
  
  let yOffset = opts?.offsetY ?? 0.09; // Slightly higher than water to avoid z-fighting

  const update = (grid: FireGrid) => {
    let idx = 0;
    const half = hm.scale * 0.5;
    const baseScale = hm.scale * 0.75; // Slightly smaller than water decals

    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        const i = z * grid.width + x;
        const tile = grid.tiles[i];
        
        // Only render if tile has significant retardant
        if (tile.retardant > 0.05) {
          const wx = x * hm.scale + half;
          const wz = z * hm.scale + half;
          const wy = hm.sample(wx, wz) + yOffset;
          
          // Scale and opacity based on retardant level
          const intensity = Math.min(tile.retardant, 1.0);
          const scale = baseScale * (0.5 + intensity * 0.5); // Scale from 50% to 100% of base
          
          tmp.position.set(wx, wy, wz);
          tmp.scale.set(scale, 1, scale);
          tmp.rotation.set(0, 0, 0);
          tmp.updateMatrix();
          m.copy(tmp.matrix);
          inst.setMatrixAt(idx++, m);
          
          // Color intensity based on retardant level - deeper red with more retardant
          const col = new Color('#8B0000');
          col.multiplyScalar(0.8 + intensity * 0.2); // Slightly brighten with more retardant
          inst.setColorAt(idx - 1, col);
        }
      }
    }

    (inst as any).count = idx;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  };

  const setOffsetY = (y: number) => { yOffset = y; };
  const setDepthTest = (on: boolean) => { (inst.material as MeshBasicMaterial).depthTest = on; };
  
  return { inst, update, setOffsetY, setDepthTest } as const;
}

export function createSuppressionDecals(hm: Heightmap, opts?: { offsetY?: number; depthTest?: boolean; renderOrder?: number }) {
  const waterDecals = createWaterDecals(hm, { ...opts, offsetY: (opts?.offsetY ?? 0) + 0.08 });
  const retardantDecals = createRetardantDecals(hm, { ...opts, offsetY: (opts?.offsetY ?? 0) + 0.09 });
  
  const update = (grid: FireGrid) => {
    waterDecals.update(grid);
    retardantDecals.update(grid);
  };
  
  const addToScene = (scene: any) => {
    scene.add(waterDecals.inst);
    scene.add(retardantDecals.inst);
  };
  
  const setOffsetY = (y: number) => {
    waterDecals.setOffsetY(y + 0.08);
    retardantDecals.setOffsetY(y + 0.09);
  };
  
  const setDepthTest = (on: boolean) => {
    waterDecals.setDepthTest(on);
    retardantDecals.setDepthTest(on);
  };
  
  return { 
    water: waterDecals, 
    retardant: retardantDecals, 
    update, 
    addToScene, 
    setOffsetY, 
    setDepthTest 
  } as const;
}