import { describe, it, expect } from 'vitest';
import { computeSmokeProfile, createFlipbookParticles } from '../particles/flipbook';
import { buildFireGrid, ignite } from '../fire/grid';
import { generateHeightmap } from '../terrain/heightmap';

describe('flipbook particles', () => {
  it('keeps smoke lifted, translucent, and wind-ready instead of blanket-like', () => {
    const profile = { baseLift: 0, rise: 0, opacity: 0, drift: 0 };
    expect(computeSmokeProfile(0.85, 1, profile)).toBe(profile);

    expect(profile.baseLift).toBeGreaterThanOrEqual(0.4);
    expect(profile.rise).toBeGreaterThanOrEqual(2.2);
    expect(profile.opacity).toBeLessThanOrEqual(0.6);
    expect(profile.drift).toBeGreaterThan(0.9);
  });

  it('populates burning and smoldering smoke attributes and clears ended sources', () => {
    const hm = generateHeightmap(8, 8, 1, {
      seed: 'particle-attributes',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const cells = (hm.width + 1) * (hm.height + 1);
    const biomes = {
      rock: new Uint8Array(cells),
      forest: new Uint8Array(cells),
      chaparral: new Uint8Array(cells),
    } as any;
    const grid = buildFireGrid(hm as any, biomes, { cellSize: hm.scale });
    const burningIdx = 3 * grid.width + 3;
    const smolderingIdx = 3 * grid.width + 4;
    grid.bCount = 1;
    grid.burning[0] = burningIdx;
    grid.heat[burningIdx] = 0.85;
    grid.sCount = 1;
    grid.smoldering[0] = smolderingIdx;
    grid.heat[smolderingIdx] = 0.2;

    const fx = createFlipbookParticles(hm as any);
    const cam: any = {
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1] },
      position: { x: 3.5, y: 10, z: 3.5 },
    };
    fx.update(grid as any, { windDirRad: 0, windSpeed: 4 }, 0.016, cam);

    const mesh: any = fx.group.children[0];
    const opacity = mesh.geometry.getAttribute('iOpacity').array as Float32Array;
    const pack3 = mesh.geometry.getAttribute('iPack3').array as Float32Array;
    expect(mesh.count).toBe(4); // two flames + burning smoke + smolder smoke
    expect(opacity[2]).toBeGreaterThan(0.5);
    expect(pack3[2 * 4]).toBeGreaterThanOrEqual(2.2);
    expect(opacity[3]).toBeLessThan(opacity[2]);
    expect(pack3[3 * 4]).toBeGreaterThan(0.7);

    grid.bCount = 0;
    grid.sCount = 0;
    fx.update(grid as any, { windDirRad: 0, windSpeed: 4 }, 0.016, cam);
    expect(mesh.count).toBe(0);
  });

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
