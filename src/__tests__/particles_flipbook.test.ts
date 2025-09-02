import { describe, it, expect } from 'vitest';
import { createFlipbookParticles } from '../particles/flipbook';
import { buildFireGrid, ignite } from '../fire/grid';
import { generateHeightmap } from '../terrain/heightmap';

describe('flipbook particles', () => {
  it('creates an instanced mesh and respects caps', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 't', frequency: 1, amplitude: 1, octaves: 1, persistence: 0.5 });
    const grid = buildFireGrid(hm as any, { rock: new Uint8Array((hm.width+1)*(hm.height+1)), forest: new Uint8Array((hm.width+1)*(hm.height+1)), chaparral: new Uint8Array((hm.width+1)*(hm.height+1)) } as any, { cellSize: hm.scale });
    ignite(grid, [{ x: 8, z: 8 }], 0.9);
    const fx = createFlipbookParticles(hm as any);
    expect(fx.group.children.length).toBeGreaterThan(0);
    const cam: any = { matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,10,20,1] }, position: { x: 10, y: 10, z: 20 } };
    fx.update(grid as any, { windDirRad: 0, windSpeed: 0 }, 0.016, cam);
    const mesh: any = fx.group.children[0];
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThanOrEqual(8000);
  });
});
