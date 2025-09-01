import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { FireGrid } from '../fire/grid';
import { computePerimeter } from '../fire/perimeter';

export function createFireRibbon(hm: Heightmap, opts?: { width?: number; yOffset?: number }) {
  const widthW = (opts?.width ?? 0.45) * hm.scale; // world-space width
  const yOff = opts?.yOffset ?? 0.1;
  const geo = new BufferGeometry();
  const mat = new MeshBasicMaterial({
    color: new Color(1, 0.6, 0.2),
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  (mesh as any).frustumCulled = false;
  mesh.renderOrder = 8;

  const tmp0 = new Vector3();
  const tmp1 = new Vector3();

  function pushSegment(verts: number[], uvs: number[], indices: number[], p0: Vector3, p1: Vector3, accLen: number): number {
    const t = new Vector3().subVectors(p1, p0);
    t.y = 0; const len = Math.max(1e-5, Math.hypot(t.x, t.z)); t.multiplyScalar(1 / len);
    const n = new Vector3(-t.z, 0, t.x);
    const l0 = tmp0.copy(p0).addScaledVector(n, widthW * 0.5);
    const r0 = tmp1.copy(p0).addScaledVector(n, -widthW * 0.5);
    const l1 = p1.clone().addScaledVector(n, widthW * 0.5);
    const r1 = p1.clone().addScaledVector(n, -widthW * 0.5);
    const base = verts.length / 3;
    verts.push(l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, l1.x, l1.y, l1.z, r1.x, r1.y, r1.z);
    uvs.push(accLen, 0, accLen, 1, accLen + len, 0, accLen + len, 1);
    indices.push(base + 0, base + 1, base + 2, base + 2, base + 1, base + 3);
    return len;
  }

  function update(grid: FireGrid, time: number) {
    const perims = computePerimeter(grid);
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const poly of perims) {
      let acc = 0;
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const ax = (a.x) * hm.scale;
        const az = (a.z) * hm.scale;
        const bx = (b.x) * hm.scale;
        const bz = (b.z) * hm.scale;
        const ay = hm.sample(ax, az) + yOff;
        const by = hm.sample(bx, bz) + yOff;
        const p0 = new Vector3(ax, ay, az);
        const p1 = new Vector3(bx, by, bz);
        acc += pushSegment(verts, uvs, indices, p0, p1, acc);
      }
    }
    if (verts.length === 0) {
      geo.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(0), 2));
      geo.setIndex([]);
      return;
    }
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    if (!(mat as any).userData._patched) {
      (mat as any).onBeforeCompile = (s: any) => {
        s.uniforms.uTime = { value: 0 };
        s.vertexShader = s.vertexShader.replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\n vUv.x += uTime * 0.35;`
        );
        s.fragmentShader = s.fragmentShader.replace(
          '#include <output_fragment>',
          `#include <output_fragment>\n float band = abs(fract(vUv.x) - 0.5);\n float flame = smoothstep(0.45, 0.0, band);\n gl_FragColor.rgb *= (0.7 + 0.3 * flame);\n gl_FragColor.a *= (0.5 + 0.5 * flame);`
        );
        (mat as any).userData.shader = s;
      };
      (mat as any).userData._patched = true;
    }
    const sh = (mat as any).userData.shader;
    if (sh) sh.uniforms.uTime.value = time;
  }

  return { mesh, update } as const;
}
