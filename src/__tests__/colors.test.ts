import { describe, it, expect } from 'vitest';
import { Heightmap } from '../terrain/heightmap';
import { applyBiomeVertexColors, BiomeMask } from '../terrain/biomes';

function makeHM(width: number, height: number): Heightmap {
  const cols = width + 1;
  const rows = height + 1;
  const data = new Float32Array(cols * rows);
  const scale = 1;
  const sample = (x: number, z: number) => data[Math.floor(z) * cols + Math.floor(x)];
  return { width, height, scale, data, sample };
}

describe('applyBiomeVertexColors', () => {
  it('assigns rock palette when rock mask = 1', () => {
    const hm = makeHM(1, 1);
    const N = (hm.width + 1) * (hm.height + 1);
    const colors = new Float32Array(N * 3);
    const mask: BiomeMask = {
      rock: new Uint8Array(N).fill(1),
      forest: new Uint8Array(N).fill(0),
      chaparral: new Uint8Array(N).fill(0),
    };
    applyBiomeVertexColors(hm, colors, mask);
    // Rock color ~ [0.60, 0.55, 0.60]
    expect(colors[0]).toBeCloseTo(0.60, 3);
    expect(colors[1]).toBeCloseTo(0.55, 3);
    expect(colors[2]).toBeCloseTo(0.60, 3);
  });

  it('blends palettes when multiple masks are 1', () => {
    const hm = makeHM(1, 1);
    const N = (hm.width + 1) * (hm.height + 1);
    const colors = new Float32Array(N * 3);
    const mask: BiomeMask = {
      rock: new Uint8Array(N).fill(1),
      forest: new Uint8Array(N).fill(1),
      chaparral: new Uint8Array(N).fill(0),
    };
    applyBiomeVertexColors(hm, colors, mask);
    // Expect a mix between rock and forest, channel-wise
    expect(colors[0]).toBeGreaterThan(0.17);
    expect(colors[0]).toBeLessThan(0.60);
    expect(colors[1]).toBeGreaterThan(0.43);
    expect(colors[1]).toBeLessThan(0.55);
  });
});

