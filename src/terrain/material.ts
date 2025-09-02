import { Color, MeshStandardMaterial } from 'three';

export function createTerrainMaterial() {
  const mat = new MeshStandardMaterial({
    color: new Color('#8ACB88'),
    flatShading: true,
    roughness: 0.75,
    metalness: 0.0,
    vertexColors: true,
  });
  // Inject grid overlay via shader hook
  mat.onBeforeCompile = (shader: any) => {
    shader.uniforms.uGridEnabled = { value: 1 };
    shader.uniforms.uGridWidth = { value: 0.03 };
    shader.uniforms.uGridColor = { value: new Color(0, 0, 0) };
    shader.uniforms.uGridFade = { value: 0.6 };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n varying vec3 vWorldPos;`
    ).replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>\n vWorldPos = worldPosition.xyz;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n varying vec3 vWorldPos;\n uniform int uGridEnabled;\n uniform float uGridWidth;\n uniform vec3 uGridColor;\n uniform float uGridFade;`
    ).replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>\n if (uGridEnabled == 1) {\n   vec2 f = fract(vWorldPos.xz);\n   vec2 g = min(f, 1.0 - f);\n   float d = min(g.x, g.y);\n   float line = smoothstep(uGridWidth, 0.0, d);\n   float fade = clamp(uGridFade, 0.0, 1.0);\n   vec3 mixColor = mix(gl_FragColor.rgb, uGridColor, line * 0.5);\n   gl_FragColor.rgb = mix(gl_FragColor.rgb, mixColor, fade);\n }`
    );

    (mat as any).userData.shader = shader;
  };

  // Convenience API
  (mat as any).setGridEnabled = (on: boolean) => {
    const s: any = (mat as any).userData.shader;
    if (s) s.uniforms.uGridEnabled.value = on ? 1 : 0;
  };
  (mat as any).setGridWidth = (w: number) => {
    const s: any = (mat as any).userData.shader;
    if (s) s.uniforms.uGridWidth.value = w;
  };
  return mat;
}
