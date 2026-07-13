import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { FireGrid } from '../fire/grid';
import { computePerimeter } from '../fire/perimeter';

type RibbonShader = {
  uniforms: Record<string, { value: number }>;
  vertexShader: string;
  fragmentShader: string;
};

export function patchRibbonShader(shader: RibbonShader, speed = 0.35) {
  shader.uniforms.uTime = { value: 0 };
  shader.uniforms.uSpeed = { value: speed };
  shader.vertexShader = `uniform float uTime;\nuniform float uSpeed;\nvarying vec2 vRibbonUv;\n${shader.vertexShader}`
    .replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\nvRibbonUv = uv;\nvRibbonUv.x += uTime * uSpeed;',
    );
  shader.fragmentShader = `varying vec2 vRibbonUv;\n${shader.fragmentShader}`
    .replace(
      '#include <output_fragment>',
      '#include <output_fragment>\nfloat band = abs(fract(vRibbonUv.x) - 0.5);\nfloat flame = smoothstep(0.45, 0.0, band);\ngl_FragColor.rgb *= (0.7 + 0.3 * flame);\ngl_FragColor.a *= (0.5 + 0.5 * flame);',
    );
}

export function createFireRibbon(hm: Heightmap, opts?: { width?: number; yOffset?: number; speed?: number; opacity?: number; visible?: boolean }) {
  let widthW = (opts?.width ?? 0.45) * hm.scale; // world-space width
  const yOff = opts?.yOffset ?? 0.1;
  const geo = new BufferGeometry();
  const mat = new MeshBasicMaterial({
    color: new Color(1, 0.6, 0.2),
    transparent: true,
    opacity: opts?.opacity ?? 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  (mesh as any).frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.visible = (opts?.visible ?? true);

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

  // The scroll/flicker animation is a shader uniform and updates every call;
  // the perimeter geometry rebuild is heavy (full-grid trace + new buffers)
  // and the boundary moves slowly, so rebuild at most 5x per second.
  let lastRebuild = -Infinity;

  function update(grid: FireGrid, time: number) {
    if (time - lastRebuild >= 0.2) {
      lastRebuild = time;
      rebuildGeometry(grid);
    }
    ensurePatched();
    const sh = (mat as any).userData.shader;
    if (sh) sh.uniforms.uTime.value = time;
  }

  function rebuildGeometry(grid: FireGrid) {
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
  }

  function ensurePatched() {
    if (!(mat as any).userData._patched) {
      (mat as any).onBeforeCompile = (s: any) => {
        patchRibbonShader(s, opts?.speed ?? 0.35);
        (mat as any).userData.shader = s;
      };
      (mat as any).userData._patched = true;
    }
  }

    const setVisible = (on: boolean) => { mesh.visible = on; };
  const setOpacity = (o: number) => { mat.opacity = Math.max(0, Math.min(1, o)); mat.needsUpdate = true; };
  const setWidth = (w: number) => { widthW = Math.max(0.05 * hm.scale, w * hm.scale); };
  const setSpeed = (v: number) => { const sh = (mat as any).userData.shader; if (sh) sh.uniforms.uSpeed.value = v; };
  const updateTerrain = (newHeightmap: Heightmap) => {
    // Update internal heightmap reference
    hm = newHeightmap;
    // Update width with new scale
    widthW = (widthW / hm.scale) * newHeightmap.scale;
  };
  return { mesh, update, setVisible, setOpacity, setWidth, setSpeed, updateTerrain } as const;
}
