import { describe, expect, it } from 'vitest';
import { patchRibbonShader } from '../particles/ribbon';

describe('fire ribbon shader patch', () => {
  it('declares and uses its own UV varying and animation uniforms', () => {
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\nvoid main() {\n#include <uv_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <output_fragment>\n}',
    };

    patchRibbonShader(shader, 0.4);

    expect(shader.uniforms.uTime.value).toBe(0);
    expect(shader.uniforms.uSpeed.value).toBe(0.4);
    expect(shader.vertexShader).toContain('uniform float uTime;');
    expect(shader.vertexShader).toContain('uniform float uSpeed;');
    expect(shader.vertexShader).toContain('varying vec2 vRibbonUv;');
    expect(shader.fragmentShader).toContain('varying vec2 vRibbonUv;');
    expect(shader.fragmentShader).not.toContain('fract(vUv.x)');
  });
});
