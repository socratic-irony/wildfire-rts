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

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function createForest(hm: Heightmap, biomes: BiomeMask) {
  // Simple conifer: cone + cylinder merged into two instanced meshes
  const leafGeo = new ConeGeometry(0.6, 1.6, 6, 1);
  const trunkGeo = new CylinderGeometry(0.15, 0.2, 0.6, 6, 1);
  leafGeo.computeVertexNormals();
  trunkGeo.computeVertexNormals();

  const leafMat = new MeshStandardMaterial({ color: new Color('#2C6E49'), flatShading: true, roughness: 0.8 });
  const trunkMat = new MeshStandardMaterial({ color: new Color('#6B4F3B'), flatShading: true, roughness: 0.9 });

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
  injectSway(leafMat);
  injectSway(trunkMat);

  // Scatter
  const rng = seededRng(12345);
  const cols = hm.width;
  const rows = hm.height;
  const instances: { x: number; z: number; y: number; rot: number; scale: number }[] = [];
  for (let z = 1; z < rows; z += 2) {
    for (let x = 1; x < cols; x += 2) {
      const i = z * (cols + 1) + x;
      if (!biomes.forest[i]) continue;
      if (rng() < 0.35) {
        const wx = (x + (rng() - 0.5) * 0.6) * hm.scale;
        const wz = (z + (rng() - 0.5) * 0.6) * hm.scale;
        const wy = hm.sample(wx, wz);
        instances.push({ x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6 });
      }
    }
  }

  const leaves = new InstancedMesh(leafGeo, leafMat, instances.length);
  const trunks = new InstancedMesh(trunkGeo, trunkMat, instances.length);
  leaves.castShadow = leaves.receiveShadow = true;
  trunks.castShadow = trunks.receiveShadow = true;

  const m = new Matrix4();
  const temp = new Object3D();
  for (let i = 0; i < instances.length; i++) {
    const it = instances[i];
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

  const update = (time: number) => {
    const sL = (leafMat as any).userData?.shader;
    const sT = (trunkMat as any).userData?.shader;
    if (sL) sL.uniforms.uTime.value = time;
    if (sT) sT.uniforms.uTime.value = time;
  };

  return { leaves, trunks, update };
}

