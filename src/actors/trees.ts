import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { createLcg } from '../core/random';
import type { Heightmap } from '../terrain/heightmap';
import type { BiomeMask } from '../terrain/biomes';
import { worldToGridCell } from '../terrain/coordinates';
import type { FireGrid } from '../fire/grid';
import { FireState } from '../fire/grid';

/** Maximum instance count in one draw batch. Keeps large maps bounded. */
export const MAX_TREE_INSTANCES_PER_BATCH = 1024;

export const TREE_FAMILY_IDS = ['pine', 'tallFir', 'roundedBroadleaf', 'spreadingOak'] as const;
export type TreeFamilyId = (typeof TREE_FAMILY_IDS)[number];

export type TreeFamilyView = {
  count: number;
  parts: readonly string[];
  meshes: readonly InstancedMesh[];
};

export type VegetationExclusion = (position: { worldX: number; worldZ: number; gridX: number; gridZ: number }) => boolean;
export type VegetationExclusionMask = Uint8Array | { readonly width: number; readonly height: number; readonly data: Uint8Array };

export type ForestOpts = {
  density?: number;         // probability per 2x2 tile in forest biome
  broadleafRatio?: number;  // 0..1 chance of broadleaf vs conifer
  exclude?: VegetationExclusion;
  exclusionMask?: VegetationExclusionMask;
};

type TreeInstance = {
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
  height: number;
  gx: number;
  gz: number;
  family: TreeFamilyId;
  leafCol: Color;
  trunkCol: Color;
};

type TreePart = {
  id: string;
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  materialKind: 'leaf' | 'wood';
  offsetX?: number;
  offsetY: number;
  offsetZ?: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationZ?: number;
};

type TreeBatch = {
  mesh: InstancedMesh;
  instances: TreeInstance[];
  materialKind: TreePart['materialKind'];
};

function addWindSway(mat: MeshStandardMaterial, speed: number, amount: number) {
  mat.onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n uniform float uTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n float sway = sin(uTime * ${speed.toFixed(2)} + position.y * 0.5) * ${amount.toFixed(3)};\n transformed.x += sway;`,
      );
    (mat as any).userData.shader = shader;
  };
}

function makeBatches(items: TreeInstance[], part: TreePart, familyId: TreeFamilyId): TreeBatch[] {
  const batches: TreeBatch[] = [];
  const matrix = new Matrix4();
  const temp = new Object3D();

  for (let start = 0; start < items.length; start += MAX_TREE_INSTANCES_PER_BATCH) {
    const batchItems = items.slice(start, start + MAX_TREE_INSTANCES_PER_BATCH);
    const mesh = new InstancedMesh(part.geometry, part.material, batchItems.length);
    mesh.name = `tree-${familyId}-${part.id}-${batches.length}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    for (let i = 0; i < batchItems.length; i++) {
      const item = batchItems[i];
      temp.position.set(
        item.x + (part.offsetX ?? 0) * item.scale,
        item.y + part.offsetY * item.scale * item.height,
        item.z + (part.offsetZ ?? 0) * item.scale,
      );
      temp.rotation.set(0, item.rot, part.rotationZ ?? 0);
      temp.scale.set(
        item.scale * part.scaleX,
        item.scale * item.height * part.scaleY,
        item.scale * part.scaleZ,
      );
      temp.updateMatrix();
      matrix.copy(temp.matrix);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, part.materialKind === 'leaf' ? item.leafCol : item.trunkCol);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    batches.push({ mesh, instances: batchItems, materialKind: part.materialKind });
  }

  return batches;
}

function getFirstMesh(
  batchesByPart: Record<string, TreeBatch[]>,
  partId: string,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  emptyMeshes: InstancedMesh[],
) {
  const mesh = batchesByPart[partId]?.[0]?.mesh;
  if (mesh) return mesh;
  const empty = new InstancedMesh(geometry, material, 0);
  empty.name = `tree-empty-${partId}`;
  emptyMeshes.push(empty);
  return empty;
}

function isExcluded(opts: ForestOpts, worldX: number, worldZ: number, gridX: number, gridZ: number) {
  if (opts.exclude?.({ worldX, worldZ, gridX, gridZ })) return true;
  const mask = opts.exclusionMask;
  if (!mask) return false;
  const width = mask instanceof Uint8Array ? Math.round(Math.sqrt(mask.length)) : mask.width;
  const height = mask instanceof Uint8Array ? Math.floor(mask.length / Math.max(1, width)) : mask.height;
  if (gridX < 0 || gridZ < 0 || gridX >= width || gridZ >= height) return false;
  const data = mask instanceof Uint8Array ? mask : mask.data;
  return data[gridZ * width + gridX] !== 0;
}

export function createForest(hm: Heightmap, biomes: BiomeMask, opts: ForestOpts = {}) {
  // The four families deliberately differ in silhouette: tiered conifers,
  // a taller three-tier fir, a single rounded broadleaf crown, and an oak
  // made from offset lobes plus an angled branch.
  const pineCone = new ConeGeometry(0.62, 1.55, 6, 1);
  const firLowerCone = new ConeGeometry(0.68, 1.35, 7, 1);
  const firUpperCone = new ConeGeometry(0.48, 1.25, 7, 1);
  const firTopCone = new ConeGeometry(0.32, 0.95, 7, 1);
  const roundedCrown = new DodecahedronGeometry(0.7, 0);
  const trunk = new CylinderGeometry(0.15, 0.22, 0.65, 6, 1);
  const oakBranch = new CylinderGeometry(0.07, 0.11, 0.72, 5, 1);
  const geometries = [pineCone, firLowerCone, firUpperCone, firTopCone, roundedCrown, trunk, oakBranch];
  for (const geometry of geometries) geometry.computeVertexNormals();
  pineCone.name = 'pine-tier';
  firLowerCone.name = 'fir-lower-tier';
  firUpperCone.name = 'fir-middle-tier';
  firTopCone.name = 'fir-top-tier';
  roundedCrown.name = 'rounded-crown';
  trunk.name = 'hex-trunk';
  oakBranch.name = 'angled-branch';

  const canopyMat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.82 });
  const woodMat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.94 });
  addWindSway(canopyMat, 1.2, 0.05);
  addWindSway(woodMat, 1.2, 0.035);
  const windMaterials = [canopyMat, woodMat];

  const parts: Record<TreeFamilyId, TreePart[]> = {
    pine: [
      { id: 'pine-lower-canopy', geometry: pineCone, material: canopyMat, materialKind: 'leaf', offsetY: 0.78, scaleX: 1, scaleY: 1, scaleZ: 1 },
      { id: 'pine-upper-canopy', geometry: firUpperCone, material: canopyMat, materialKind: 'leaf', offsetY: 1.48, scaleX: 0.8, scaleY: 0.9, scaleZ: 0.8 },
      { id: 'pine-trunk', geometry: trunk, material: woodMat, materialKind: 'wood', offsetY: 0.32, scaleX: 1, scaleY: 1, scaleZ: 1 },
    ],
    tallFir: [
      { id: 'fir-lower-canopy', geometry: firLowerCone, material: canopyMat, materialKind: 'leaf', offsetY: 0.78, scaleX: 1, scaleY: 1.15, scaleZ: 1 },
      { id: 'fir-middle-canopy', geometry: firUpperCone, material: canopyMat, materialKind: 'leaf', offsetY: 1.55, scaleX: 0.9, scaleY: 1.05, scaleZ: 0.9 },
      { id: 'fir-top-canopy', geometry: firTopCone, material: canopyMat, materialKind: 'leaf', offsetY: 2.08, scaleX: 0.72, scaleY: 1, scaleZ: 0.72 },
      { id: 'fir-trunk', geometry: trunk, material: woodMat, materialKind: 'wood', offsetY: 0.32, scaleX: 1.05, scaleY: 1.15, scaleZ: 1.05 },
    ],
    roundedBroadleaf: [
      { id: 'broadleaf-crown', geometry: roundedCrown, material: canopyMat, materialKind: 'leaf', offsetY: 0.92, scaleX: 1.18, scaleY: 1, scaleZ: 1.12 },
      { id: 'broadleaf-trunk', geometry: trunk, material: woodMat, materialKind: 'wood', offsetY: 0.32, scaleX: 1.1, scaleY: 1.05, scaleZ: 1.1 },
    ],
    spreadingOak: [
      { id: 'oak-crown-left', geometry: roundedCrown, material: canopyMat, materialKind: 'leaf', offsetX: -0.3, offsetY: 0.9, scaleX: 0.9, scaleY: 0.82, scaleZ: 0.95 },
      { id: 'oak-crown-center', geometry: roundedCrown, material: canopyMat, materialKind: 'leaf', offsetY: 1.08, scaleX: 1.02, scaleY: 0.84, scaleZ: 1.02 },
      { id: 'oak-crown-right', geometry: roundedCrown, material: canopyMat, materialKind: 'leaf', offsetX: 0.34, offsetY: 0.86, scaleX: 0.88, scaleY: 0.78, scaleZ: 0.92 },
      { id: 'oak-trunk', geometry: trunk, material: woodMat, materialKind: 'wood', offsetY: 0.34, scaleX: 1.3, scaleY: 1.05, scaleZ: 1.3 },
      { id: 'oak-angled-branch', geometry: oakBranch, material: woodMat, materialKind: 'wood', offsetX: 0.19, offsetY: 0.68, scaleX: 1, scaleY: 0.95, scaleZ: 1, rotationZ: -0.82 },
    ],
  };

  const rng = createLcg(12345);
  const cols = hm.width;
  const rows = hm.height;
  const instances: Record<TreeFamilyId, TreeInstance[]> = {
    pine: [],
    tallFir: [],
    roundedBroadleaf: [],
    spreadingOak: [],
  };
  const density = opts.density ?? 0.30;
  const broadleafRatio = Math.min(1, Math.max(0, opts.broadleafRatio ?? 0.4));

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
      const biomeIndex = z * (cols + 1) + x;
      if (!biomes.forest[biomeIndex] || rng() >= density) continue;
      const wx = (x + (rng() - 0.5) * 0.6) * hm.scale;
      const wz = (z + (rng() - 0.5) * 0.6) * hm.scale;
      const wy = hm.sample(wx, wz);
      const { x: gx, z: gz } = worldToGridCell(hm, wx, wz);
      const isBroadleaf = rng() < broadleafRatio;
      const family = isBroadleaf
        ? (rng() < 0.5 ? 'roundedBroadleaf' : 'spreadingOak')
        : (rng() < 0.5 ? 'pine' : 'tallFir');
      const base = isBroadleaf ? (family === 'spreadingOak' ? '#557A3E' : '#4CAF50') : (family === 'tallFir' ? '#285943' : '#2C6E49');
      const instance: TreeInstance = {
        x: wx,
        z: wz,
        y: wy,
        rot: rng() * Math.PI * 2,
        scale: 0.85 + rng() * 0.6,
        height: isBroadleaf ? 0.9 + rng() * 0.35 : 0.85 + rng() * 0.55,
        gx,
        gz,
        family,
        leafCol: makeLeafCol(base),
        trunkCol: makeTrunkCol(),
      };
      // Evaluate after all random draws for this candidate. Excluding a
      // footprint therefore cannot shift the deterministic stream for later
      // candidates.
      if (!isExcluded(opts, wx, wz, gx, gz)) instances[family].push(instance);
    }
  }

  const familyBatches = {} as Record<TreeFamilyId, TreeBatch[]>;
  const batchesByPart = {} as Record<TreeFamilyId, Record<string, TreeBatch[]>>;
  const visibleMeshes: InstancedMesh[] = [];
  const group = new Group();
  group.name = 'forest';
  const families = {} as Record<TreeFamilyId, TreeFamilyView>;

  for (const familyId of TREE_FAMILY_IDS) {
    const familyPartBatches: Record<string, TreeBatch[]> = {};
    const familyMeshes: InstancedMesh[] = [];
    familyBatches[familyId] = [];
    for (const part of parts[familyId]) {
      const batches = makeBatches(instances[familyId], part, familyId);
      familyPartBatches[part.id] = batches;
      for (const batch of batches) {
        familyBatches[familyId].push(batch);
        familyMeshes.push(batch.mesh);
        visibleMeshes.push(batch.mesh);
        group.add(batch.mesh);
      }
    }
    batchesByPart[familyId] = familyPartBatches;
    families[familyId] = { count: instances[familyId].length, parts: parts[familyId].map((part) => part.id), meshes: familyMeshes };
  }

  const emptyMeshes: InstancedMesh[] = [];
  const leaves = getFirstMesh(batchesByPart.pine, 'pine-lower-canopy', pineCone, canopyMat, emptyMeshes);
  const leavesUpper = getFirstMesh(batchesByPart.pine, 'pine-upper-canopy', firUpperCone, canopyMat, emptyMeshes);
  const trunks = getFirstMesh(batchesByPart.pine, 'pine-trunk', trunk, woodMat, emptyMeshes);
  const broadLeaves = getFirstMesh(batchesByPart.roundedBroadleaf, 'broadleaf-crown', roundedCrown, canopyMat, emptyMeshes);
  const broadTrunks = getFirstMesh(batchesByPart.roundedBroadleaf, 'broadleaf-trunk', trunk, woodMat, emptyMeshes);

  const meshes = visibleMeshes;
  const update = (time: number) => {
    for (const mat of windMaterials) {
      const shader = (mat as any).userData?.shader;
      if (shader) shader.uniforms.uTime.value = time;
    }
  };

  const tmpFactor = new Color();
  const tmpOut = new Color();
  const factorForState = (state: FireState): Color | null => {
    if (state === FireState.Burned) return tmpFactor.setRGB(0.1, 0.1, 0.1);
    if (state === FireState.Smoldering) return tmpFactor.setRGB(0.75, 0.5, 0.32);
    if (state === FireState.Burning) return tmpFactor.setRGB(0.95, 0.62, 0.4);
    return null;
  };
  const applyFireTint = (grid: FireGrid) => {
    for (const familyId of TREE_FAMILY_IDS) {
      for (const batch of familyBatches[familyId]) {
        for (let i = 0; i < batch.instances.length; i++) {
          const item = batch.instances[i];
          const state = grid.state[item.gz * grid.width + item.gx] ?? FireState.Unburned;
          const factor = factorForState(state);
          const base = batch.materialKind === 'leaf' ? item.leafCol : item.trunkCol;
          batch.mesh.setColorAt(i, factor ? tmpOut.copy(base).multiply(factor) : base);
        }
        if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      }
    }
  };

  const dispose = () => {
    for (const mesh of meshes) mesh.dispose();
    for (const mesh of emptyMeshes) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    canopyMat.dispose();
    woodMat.dispose();
  };

  return {
    group,
    meshes,
    families,
    instances,
    leaves,
    leavesUpper,
    trunks,
    broadLeaves,
    broadTrunks,
    update,
    applyFireTint,
    dispose,
  };
}
