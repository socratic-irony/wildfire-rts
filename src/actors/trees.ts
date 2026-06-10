import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { Heightmap } from '../terrain/heightmap';
import { BiomeMask } from '../terrain/biomes';
import type { FireGrid } from '../fire/grid';
import { FireState } from '../fire/grid';

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
  // Conifer: two stacked cone tiers + cylinder trunk
  const conLeafGeo = new ConeGeometry(0.6, 1.6, 6, 1);
  const conLeafUpperGeo = new ConeGeometry(0.42, 1.0, 6, 1);
  const conTrunkGeo = new CylinderGeometry(0.15, 0.2, 0.6, 6, 1);
  conLeafGeo.computeVertexNormals();
  conLeafUpperGeo.computeVertexNormals();
  conTrunkGeo.computeVertexNormals();

  // Broadleaf: squat cone approximates a lumpy canopy
  const broadLeafGeo = new CylinderGeometry(0.0, 0.9, 0.8, 6, 1);
  const broadTrunkGeo = new CylinderGeometry(0.18, 0.22, 0.5, 6, 1);
  broadLeafGeo.computeVertexNormals();
  broadTrunkGeo.computeVertexNormals();

  const conLeafMat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.8 });
  const conTrunkMat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.9 });
  const broadLeafMat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.85 });
  const broadTrunkMat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.95 });

  // Wind sway
  const injectSway = (mat: MeshStandardMaterial) => {
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n uniform float uTime;`
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n float sway = sin(uTime * 1.2 + position.y * 0.5) * 0.05;\n transformed.x += sway;`
      );
      (mat as any).userData.shader = shader;
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
  type TreeInst = {
    x: number; z: number; y: number; rot: number;
    scale: number; height: number;
    gx: number; gz: number;
    leafCol: Color; trunkCol: Color;
  };
  const conifers: TreeInst[] = [];
  const broad: TreeInst[] = [];
  const density = opts.density ?? 0.30;
  const broadleafRatio = opts.broadleafRatio ?? 0.4; // default 60/40 conifer/broad

  // Per-instance base colors: conifers range deep pine → bluish spruce,
  // broadleaf range yellow-green → rich green. Trunks vary brown depth.
  const makeLeafCol = (base: string) => {
    const c = new Color(base);
    c.offsetHSL((rng() - 0.5) * 0.05, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.1);
    return c;
  };
  const makeTrunkCol = () => {
    const c = new Color('#6B4F3B');
    c.offsetHSL(0, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.12);
    return c;
  };

  for (let z = 1; z < rows; z += 2) {
    for (let x = 1; x < cols; x += 2) {
      const i = z * (cols + 1) + x;
      if (!biomes.forest[i]) continue;
      if (rng() < density) {
        const jx = (rng() - 0.5) * 0.6;
        const jz = (rng() - 0.5) * 0.6;
        const wx = (x + jx) * hm.scale;
        const wz = (z + jz) * hm.scale;
        const wy = hm.sample(wx, wz);
        const gx = Math.max(0, Math.min(hm.width - 1, Math.round(wx / hm.scale)));
        const gz = Math.max(0, Math.min(hm.height - 1, Math.round(wz / hm.scale)));
        if (rng() >= broadleafRatio) {
          conifers.push({
            x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2,
            scale: 0.85 + rng() * 0.6, height: 0.85 + rng() * 0.55,
            gx, gz, leafCol: makeLeafCol('#2C6E49'), trunkCol: makeTrunkCol(),
          });
        } else {
          broad.push({
            x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2,
            scale: 0.9 + rng() * 0.7, height: 0.9 + rng() * 0.35,
            gx, gz, leafCol: makeLeafCol('#4CAF50'), trunkCol: makeTrunkCol(),
          });
        }
      }
    }
  }

  const leaves = new InstancedMesh(conLeafGeo, conLeafMat, conifers.length);
  const leavesUpper = new InstancedMesh(conLeafUpperGeo, conLeafMat, conifers.length);
  const trunks = new InstancedMesh(conTrunkGeo, conTrunkMat, conifers.length);
  const broadLeaves = new InstancedMesh(broadLeafGeo, broadLeafMat, broad.length);
  const broadTrunks = new InstancedMesh(broadTrunkGeo, broadTrunkMat, broad.length);
  const allMeshes = [leaves, leavesUpper, trunks, broadLeaves, broadTrunks];
  for (const m of allMeshes) { m.castShadow = true; m.receiveShadow = true; }

  const group = new Group();
  group.name = 'forest';
  for (const m of allMeshes) group.add(m);

  const m = new Matrix4();
  const temp = new Object3D();
  for (let i = 0; i < conifers.length; i++) {
    const it = conifers[i];
    temp.position.set(it.x, it.y + 0.8 * it.scale * it.height, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.set(it.scale, it.scale * it.height, it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    leaves.setMatrixAt(i, m);

    temp.position.set(it.x, it.y + 1.55 * it.scale * it.height, it.z);
    temp.updateMatrix();
    m.copy(temp.matrix);
    leavesUpper.setMatrixAt(i, m);

    temp.position.set(it.x, it.y + 0.3 * it.scale, it.z);
    temp.scale.setScalar(it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    trunks.setMatrixAt(i, m);

    leaves.setColorAt(i, it.leafCol);
    leavesUpper.setColorAt(i, it.leafCol);
    trunks.setColorAt(i, it.trunkCol);
  }
  for (let i = 0; i < broad.length; i++) {
    const it = broad[i];
    temp.position.set(it.x, it.y + 0.65 * it.scale * it.height, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.set(it.scale, it.scale * it.height, it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    broadLeaves.setMatrixAt(i, m);

    temp.position.set(it.x, it.y + 0.25 * it.scale, it.z);
    temp.scale.setScalar(0.9 * it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    broadTrunks.setMatrixAt(i, m);

    broadLeaves.setColorAt(i, it.leafCol);
    broadTrunks.setColorAt(i, it.trunkCol);
  }
  for (const mesh of allMeshes) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  const update = (time: number) => {
    for (const mat of [conLeafMat, conTrunkMat, broadLeafMat, broadTrunkMat]) {
      const s = (mat as any).userData?.shader;
      if (s) s.uniforms.uTime.value = time;
    }
  };

  // Burn tinting per instance: multiply each tree's base color by the fire
  // state factor so unburned trees keep their per-instance variety.
  const tmpFactor = new Color();
  const tmpOut = new Color();
  const applyFireTint = (grid: FireGrid) => {
    const factorForState = (state: FireState): Color | null => {
      if (state === FireState.Burned) return tmpFactor.setRGB(0.1, 0.1, 0.1);
      if (state === FireState.Smoldering) return tmpFactor.setRGB(0.75, 0.5, 0.32);
      if (state === FireState.Burning) return tmpFactor.setRGB(0.95, 0.62, 0.4);
      return null;
    };
    const apply = (
      list: TreeInst[],
      leafMeshes: InstancedMesh[],
      trunkMesh: InstancedMesh,
    ) => {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const idx = it.gz * grid.width + it.gx;
        const state = grid.tiles[idx]?.state ?? FireState.Unburned;
        const f = factorForState(state);
        for (const lm of leafMeshes) {
          lm.setColorAt(i, f ? tmpOut.copy(it.leafCol).multiply(f) : it.leafCol);
        }
        trunkMesh.setColorAt(i, f ? tmpOut.copy(it.trunkCol).multiply(f) : it.trunkCol);
      }
    };
    apply(conifers, [leaves, leavesUpper], trunks);
    apply(broad, [broadLeaves], broadTrunks);
    for (const mesh of allMeshes) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  return { group, leaves, leavesUpper, trunks, broadLeaves, broadTrunks, update, applyFireTint };
}
