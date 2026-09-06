import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
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

/** Maximum instance count in one draw batch. Keeps dense chaparral bounded. */
export const MAX_SHRUB_INSTANCES_PER_BATCH = 1024;

export const SHRUB_FAMILY_IDS = ['roundedMultiLobed', 'lowSpreadingScrub', 'uprightBrush'] as const;
export type ShrubFamilyId = (typeof SHRUB_FAMILY_IDS)[number];

export type ShrubFamilyView = {
  count: number;
  parts: readonly string[];
  meshes: readonly InstancedMesh[];
};

export type ShrubVegetationExclusion = (position: { worldX: number; worldZ: number; gridX: number; gridZ: number }) => boolean;
export type ShrubVegetationExclusionMask = Uint8Array | { readonly width: number; readonly height: number; readonly data: Uint8Array };
export type ShrubOpts = {
  density?: number;
  exclude?: ShrubVegetationExclusion;
  exclusionMask?: ShrubVegetationExclusionMask;
};

type ShrubInstance = {
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
  squash: number;
  gx: number;
  gz: number;
  baseCol: Color;
};

type ShrubPart = {
  id: string;
  geometry: BufferGeometry;
  offsetX?: number;
  offsetY: number;
  offsetZ?: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
};

type ShrubBatch = {
  mesh: InstancedMesh;
  instances: ShrubInstance[];
};

function isExcluded(opts: ShrubOpts, worldX: number, worldZ: number, gridX: number, gridZ: number) {
  if (opts.exclude?.({ worldX, worldZ, gridX, gridZ })) return true;
  const mask = opts.exclusionMask;
  if (!mask) return false;
  const width = mask instanceof Uint8Array ? Math.round(Math.sqrt(mask.length)) : mask.width;
  const height = mask instanceof Uint8Array ? Math.floor(mask.length / Math.max(1, width)) : mask.height;
  if (gridX < 0 || gridZ < 0 || gridX >= width || gridZ >= height) return false;
  const data = mask instanceof Uint8Array ? mask : mask.data;
  return data[gridZ * width + gridX] !== 0;
}

function addWindSway(mat: MeshStandardMaterial) {
  mat.onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n uniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n float sway = sin(uTime * 1.5 + position.y) * 0.03;\n transformed.x += sway;',
      );
    (mat as any).userData.shader = shader;
  };
}

function makeBatches(items: ShrubInstance[], part: ShrubPart, familyId: ShrubFamilyId, mat: MeshStandardMaterial): ShrubBatch[] {
  const batches: ShrubBatch[] = [];
  const matrix = new Matrix4();
  const temp = new Object3D();

  for (let start = 0; start < items.length; start += MAX_SHRUB_INSTANCES_PER_BATCH) {
    const batchItems = items.slice(start, start + MAX_SHRUB_INSTANCES_PER_BATCH);
    const mesh = new InstancedMesh(part.geometry, mat, batchItems.length);
    mesh.name = `shrub-${familyId}-${part.id}-${batches.length}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < batchItems.length; i++) {
      const item = batchItems[i];
      temp.position.set(
        item.x + (part.offsetX ?? 0) * item.scale,
        item.y + part.offsetY * item.scale * item.squash,
        item.z + (part.offsetZ ?? 0) * item.scale,
      );
      temp.rotation.set(0, item.rot, 0);
      temp.scale.set(
        item.scale * part.scaleX,
        item.scale * item.squash * part.scaleY,
        item.scale * part.scaleZ,
      );
      temp.updateMatrix();
      matrix.copy(temp.matrix);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, item.baseCol);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    batches.push({ mesh, instances: batchItems });
  }

  return batches;
}

export function createShrubs(hm: Heightmap, biomes: BiomeMask, opts: ShrubOpts = {}) {
  // Shared low-poly primitives are arranged into three silhouettes: a
  // multi-lobed clump, a flattened spreading scrub, and an upright brush.
  const roundGeo = new IcosahedronGeometry(0.35, 1);
  const scrubGeo = new IcosahedronGeometry(0.4, 0);
  const brushGeo = new ConeGeometry(0.28, 0.8, 5, 1);
  const geometries = [roundGeo, scrubGeo, brushGeo];
  for (const geometry of geometries) geometry.computeVertexNormals();
  roundGeo.name = 'rounded-shrub-lobe';
  scrubGeo.name = 'spreading-scrub-clump';
  brushGeo.name = 'upright-brush-stem';

  const mat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.9 });
  addWindSway(mat);

  const parts: Record<ShrubFamilyId, ShrubPart[]> = {
    roundedMultiLobed: [
      { id: 'rounded-center', geometry: roundGeo, offsetY: 0.42, scaleX: 1, scaleY: 0.85, scaleZ: 1 },
      { id: 'rounded-left-lobe', geometry: roundGeo, offsetX: -0.2, offsetY: 0.3, scaleX: 0.76, scaleY: 0.68, scaleZ: 0.82 },
      { id: 'rounded-right-lobe', geometry: roundGeo, offsetX: 0.2, offsetY: 0.32, scaleX: 0.72, scaleY: 0.64, scaleZ: 0.8 },
    ],
    lowSpreadingScrub: [
      { id: 'scrub-main', geometry: scrubGeo, offsetY: 0.32, scaleX: 1.35, scaleY: 0.52, scaleZ: 1.05 },
      { id: 'scrub-back-lobe', geometry: scrubGeo, offsetZ: -0.2, offsetY: 0.28, scaleX: 0.78, scaleY: 0.44, scaleZ: 0.8 },
    ],
    uprightBrush: [
      { id: 'brush-main', geometry: brushGeo, offsetY: 0.55, scaleX: 0.9, scaleY: 1.15, scaleZ: 0.9 },
      { id: 'brush-side-stem', geometry: brushGeo, offsetX: 0.13, offsetY: 0.42, scaleX: 0.52, scaleY: 0.78, scaleZ: 0.52 },
    ],
  };

  const rng = createLcg(67890);
  const cols = hm.width;
  const rows = hm.height;
  const instances: Record<ShrubFamilyId, ShrubInstance[]> = {
    roundedMultiLobed: [],
    lowSpreadingScrub: [],
    uprightBrush: [],
  };
  const density = opts.density ?? 0.15;
  for (let z = 1; z < rows; z++) {
    for (let x = 1; x < cols; x++) {
      const biomeIndex = z * (cols + 1) + x;
      if (!biomes.chaparral[biomeIndex] || rng() >= density) continue;
      const wx = (x + (rng() - 0.5) * 0.8) * hm.scale;
      const wz = (z + (rng() - 0.5) * 0.8) * hm.scale;
      const wy = hm.sample(wx, wz);
      const { x: gx, z: gz } = worldToGridCell(hm, wx, wz);
      const family = SHRUB_FAMILY_IDS[Math.floor(rng() * SHRUB_FAMILY_IDS.length)];
      const baseCol = new Color('#6FA06F');
      baseCol.offsetHSL((rng() - 0.5) * 0.08, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.12);
      const instance: ShrubInstance = {
        x: wx,
        z: wz,
        y: wy,
        rot: rng() * Math.PI * 2,
        scale: 0.8 + rng() * 0.4,
        squash: 0.55 + rng() * 0.6,
        gx,
        gz,
        baseCol,
      };
      // Consume the complete candidate sequence before exclusion so road or
      // building masks cannot reshuffle later deterministic placements.
      if (!isExcluded(opts, wx, wz, gx, gz)) instances[family].push(instance);
    }
  }

  const familyBatches = {} as Record<ShrubFamilyId, ShrubBatch[]>;
  const visibleMeshes: InstancedMesh[] = [];
  const group = new Group();
  group.name = 'shrubs';
  const families = {} as Record<ShrubFamilyId, ShrubFamilyView>;
  for (const familyId of SHRUB_FAMILY_IDS) {
    const familyMeshes: InstancedMesh[] = [];
    familyBatches[familyId] = [];
    for (const part of parts[familyId]) {
      const batches = makeBatches(instances[familyId], part, familyId, mat);
      for (const batch of batches) {
        familyBatches[familyId].push(batch);
        familyMeshes.push(batch.mesh);
        visibleMeshes.push(batch.mesh);
        group.add(batch.mesh);
      }
    }
    families[familyId] = { count: instances[familyId].length, parts: parts[familyId].map((part) => part.id), meshes: familyMeshes };
  }

  // Preserve the original `inst` handle as the primary rounded shrub batch.
  const inst = familyBatches.roundedMultiLobed[0]?.mesh ?? new InstancedMesh(roundGeo, mat, 0);
  if (!inst.parent) inst.name = 'shrub-empty-rounded-center';

  const update = (time: number) => {
    const shader = (mat as any).userData?.shader;
    if (shader) shader.uniforms.uTime.value = time;
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
    for (const familyId of SHRUB_FAMILY_IDS) {
      for (const batch of familyBatches[familyId]) {
        for (let i = 0; i < batch.instances.length; i++) {
          const item = batch.instances[i];
          const state = grid.state[item.gz * grid.width + item.gx] ?? FireState.Unburned;
          const factor = factorForState(state);
          batch.mesh.setColorAt(i, factor ? tmpOut.copy(item.baseCol).multiply(factor) : item.baseCol);
        }
        if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      }
    }
  };

  const dispose = () => {
    for (const mesh of visibleMeshes) mesh.dispose();
    if (!inst.parent && !visibleMeshes.includes(inst)) inst.dispose();
    for (const geometry of geometries) geometry.dispose();
    mat.dispose();
  };

  return { group, inst, meshes: visibleMeshes, families, instances, update, applyFireTint, dispose };
}
