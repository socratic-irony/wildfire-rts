import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Shader,
  Vector3,
} from 'three';
import { Heightmap } from '../terrain/heightmap';
import { BiomeMask } from '../terrain/biomes';

type ForestOpts = {
  density?: number;         // probability per 2x2 tile in forest biome
  broadleafRatio?: number;  // 0..1 chance of broadleaf vs conifer
};

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function createForest(hm: Heightmap, biomes: BiomeMask, opts: ForestOpts = {}) {
  // Conifer: 2-stack cone leaves + cylinder trunk
  const conLeafGeo = new ConeGeometry(0.6, 1.6, 6, 1);
  const conTrunkGeo = new CylinderGeometry(0.15, 0.2, 0.6, 6, 1);
  conLeafGeo.computeVertexNormals();
  conTrunkGeo.computeVertexNormals();

  // Broadleaf: low-poly sphere canopy (icosa-ish via cone with many sides?) keep low sides; reuse cone with more segments looks too smooth
  const broadLeafGeo = new CylinderGeometry(0.0, 0.9, 0.8, 6, 1); // squat cone approximates lumpy canopy
  const broadTrunkGeo = new CylinderGeometry(0.18, 0.22, 0.5, 6, 1);
  broadLeafGeo.computeVertexNormals();
  broadTrunkGeo.computeVertexNormals();

  const conLeafMat = new MeshStandardMaterial({ color: new Color('#2C6E49'), flatShading: true, roughness: 0.8 });
  const conTrunkMat = new MeshStandardMaterial({ color: new Color('#6B4F3B'), flatShading: true, roughness: 0.9 });
  const broadLeafMat = new MeshStandardMaterial({ color: new Color('#4CAF50'), flatShading: true, roughness: 0.85 });
  const broadTrunkMat = new MeshStandardMaterial({ color: new Color('#6B4F3B'), flatShading: true, roughness: 0.95 });

  // Wind sway
  const injectSway = (mat: MeshStandardMaterial) => {
    mat.onBeforeCompile = (s: Shader) => {
      s.uniforms.uTime = { value: 0 };
      s.vertexShader = s.vertexShader.replace(
        '#include <common>',
        `#include <common>\n uniform float uTime;`
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n float sway = sin(uTime * 1.2 + position.y * 0.5) * 0.05;\n transformed.x += sway;`
      );
      (mat as any).userData.shader = s;
    };
  };
  injectSway(conLeafMat);
  injectSway(conTrunkMat);
  injectSway(broadLeafMat);
  injectSway(broadTrunkMat);

  // Scatter
  const rng = seededRng(12345);
  const cols = hm.width;
  const rows = hm.height;
  const conifers: { x: number; z: number; y: number; rot: number; scale: number }[] = [];
  const broad: { x: number; z: number; y: number; rot: number; scale: number }[] = [];
  const density = opts.density ?? 0.30;
  const broadleafRatio = opts.broadleafRatio ?? 0.4; // default 60/40 conifer/broad
  for (let z = 1; z < rows; z += 2) {
    for (let x = 1; x < cols; x += 2) {
      const i = z * (cols + 1) + x;
      if (!biomes.forest[i]) continue;
      if (rng() < density) {
        const wx = (x + (rng() - 0.5) * 0.6) * hm.scale;
        const wz = (z + (rng() - 0.5) * 0.6) * hm.scale;
        const wy = hm.sample(wx, wz);
        // Species split using ratio
        if (rng() >= broadleafRatio) conifers.push({ x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2, scale: 0.85 + rng() * 0.6 });
        else broad.push({ x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.7 });
      }
    }
  }

  const leaves = new InstancedMesh(conLeafGeo, conLeafMat, conifers.length);
  const trunks = new InstancedMesh(conTrunkGeo, conTrunkMat, conifers.length);
  const broadLeaves = new InstancedMesh(broadLeafGeo, broadLeafMat, broad.length);
  const broadTrunks = new InstancedMesh(broadTrunkGeo, broadTrunkMat, broad.length);
  for (const m of [leaves, trunks, broadLeaves, broadTrunks]) { m.castShadow = true; m.receiveShadow = true; }

  const m = new Matrix4();
  const temp = new Object3D();
  for (let i = 0; i < conifers.length; i++) {
    const it = conifers[i];
    temp.position.set(it.x, it.y + 0.8 * it.scale, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.setScalar(it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    leaves.setMatrixAt(i, m);

    temp.position.set(it.x, it.y + 0.3 * it.scale, it.z);
    temp.scale.setScalar(it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    trunks.setMatrixAt(i, m);
  }
  for (let i = 0; i < broad.length; i++) {
    const it = broad[i];
    temp.position.set(it.x, it.y + 0.65 * it.scale, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.setScalar(it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    broadLeaves.setMatrixAt(i, m);

    temp.position.set(it.x, it.y + 0.25 * it.scale, it.z);
    temp.scale.setScalar(0.9 * it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    broadTrunks.setMatrixAt(i, m);
  }

  const update = (time: number) => {
    const sL = (conLeafMat as any).userData?.shader;
    const sT = (conTrunkMat as any).userData?.shader;
    const sBL = (broadLeafMat as any).userData?.shader;
    const sBT = (broadTrunkMat as any).userData?.shader;
    if (sL) sL.uniforms.uTime.value = time;
    if (sT) sT.uniforms.uTime.value = time;
    if (sBL) sBL.uniforms.uTime.value = time;
    if (sBT) sBT.uniforms.uTime.value = time;
  };

  return { leaves, trunks, broadLeaves, broadTrunks, update };
}
