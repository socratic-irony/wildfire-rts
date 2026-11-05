import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../core/rng';
import { GRID_SIZE, TILE_SIZE, tileIndex } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain } from './biomes';
import { RoadNetwork } from './roads';
import { BuildingSystem } from './buildings';

interface Part {
  geometry: BufferGeometry;
  color: number;
  matrix: Matrix4;
}

interface InstanceRecord {
  tile: number;
  tint: Color;
}

interface SpeciesBatch {
  mesh: InstancedMesh;
  records: InstanceRecord[];
  material: MeshStandardMaterial;
}

export const SPECIES = [
  'pine',
  'fir',
  'cypress',
  'oak',
  'aspen',
  'snag',
  'manzanita',
  'shrub',
  'tuft',
  'flowers',
  'rock',
  'boulders',
  'log',
] as const;
export type Species = (typeof SPECIES)[number];

interface SpeciesSpec {
  /** Base uniform scale and random range multiplier. */
  scale: number;
  scaleRange: [number, number];
  /** Extra vertical stretch range (trees vary in height more than width). */
  stretch: [number, number];
  /** How far from the tile centre an instance may wander, in tiles. */
  jitter: number;
  /** Steepest tile slope (tan) the species will grow on. */
  maxSlope: number;
  castShadow: boolean;
  /** Per-instance colour drift: [hue, saturation, lightness] half-ranges. */
  drift: [number, number, number];
}

const SPEC: Record<Species, SpeciesSpec> = {
  pine: { scale: 0.92, scaleRange: [0.72, 1.3], stretch: [0.9, 1.25], jitter: 0.75, maxSlope: 1.05, castShadow: true, drift: [0.02, 0.08, 0.06] },
  fir: { scale: 0.9, scaleRange: [0.75, 1.3], stretch: [0.95, 1.35], jitter: 0.75, maxSlope: 1.05, castShadow: true, drift: [0.03, 0.06, 0.05] },
  cypress: { scale: 0.85, scaleRange: [0.8, 1.15], stretch: [0.9, 1.2], jitter: 0.6, maxSlope: 0.5, castShadow: true, drift: [0.01, 0.05, 0.04] },
  oak: { scale: 0.9, scaleRange: [0.72, 1.32], stretch: [0.9, 1.1], jitter: 0.78, maxSlope: 1.05, castShadow: true, drift: [0.04, 0.1, 0.07] },
  aspen: { scale: 0.85, scaleRange: [0.75, 1.2], stretch: [0.95, 1.3], jitter: 0.75, maxSlope: 1.05, castShadow: true, drift: [0.05, 0.12, 0.06] },
  snag: { scale: 0.9, scaleRange: [0.8, 1.25], stretch: [0.9, 1.3], jitter: 0.7, maxSlope: 1.05, castShadow: true, drift: [0.01, 0.03, 0.06] },
  manzanita: { scale: 0.7, scaleRange: [0.75, 1.25], stretch: [0.9, 1.15], jitter: 0.75, maxSlope: 1.05, castShadow: true, drift: [0.03, 0.08, 0.06] },
  shrub: { scale: 0.62, scaleRange: [0.72, 1.34], stretch: [0.85, 1.15], jitter: 0.78, maxSlope: 1.05, castShadow: false, drift: [0.04, 0.1, 0.07] },
  tuft: { scale: 0.75, scaleRange: [0.7, 1.3], stretch: [0.8, 1.3], jitter: 0.85, maxSlope: 1.05, castShadow: false, drift: [0.03, 0.12, 0.08] },
  flowers: { scale: 0.8, scaleRange: [0.8, 1.2], stretch: [0.9, 1.1], jitter: 0.8, maxSlope: 0.5, castShadow: false, drift: [0.0, 0.05, 0.05] },
  rock: { scale: 0.7, scaleRange: [0.72, 1.34], stretch: [0.8, 1.2], jitter: 0.55, maxSlope: 1.5, castShadow: true, drift: [0.02, 0.04, 0.08] },
  boulders: { scale: 0.85, scaleRange: [0.8, 1.2], stretch: [0.85, 1.1], jitter: 0.4, maxSlope: 1.5, castShadow: true, drift: [0.02, 0.04, 0.08] },
  log: { scale: 0.9, scaleRange: [0.8, 1.2], stretch: [1, 1], jitter: 0.55, maxSlope: 0.15, castShadow: true, drift: [0.01, 0.05, 0.06] },
};

/** Cumulative-probability planting tables per terrain type. */
type PlantTable = ReadonlyArray<readonly [Species, number]>;
const TABLES: Partial<Record<Terrain, PlantTable>> = {
  [Terrain.Forest]: [
    ['pine', 0.2],
    ['fir', 0.13],
    ['oak', 0.1],
    ['aspen', 0.04],
    ['snag', 0.018],
    ['log', 0.03],
    ['shrub', 0.07],
    ['tuft', 0.04],
  ],
  [Terrain.Brush]: [
    ['manzanita', 0.12],
    ['shrub', 0.15],
    ['oak', 0.045],
    ['tuft', 0.07],
    ['rock', 0.03],
    ['boulders', 0.012],
    ['snag', 0.006],
  ],
  [Terrain.Grass]: [
    ['tuft', 0.1],
    ['flowers', 0.025],
    ['oak', 0.03],
    ['shrub', 0.02],
    ['rock', 0.012],
    ['aspen', 0.006],
  ],
  [Terrain.Rock]: [
    ['rock', 0.08],
    ['boulders', 0.05],
    ['pine', 0.02],
    ['snag', 0.012],
    ['shrub', 0.02],
    ['tuft', 0.03],
  ],
  [Terrain.Urban]: [
    ['cypress', 0.035],
    ['oak', 0.02],
    ['aspen', 0.015],
    ['flowers', 0.04],
    ['tuft', 0.02],
  ],
};

interface PlantInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  stretch: number;
  rotation: number;
  tilt: number;
  tile: number;
  tint: Color;
}

export class VegetationSystem {
  readonly group = new Group();
  readonly instancesBySpecies = new Map<Species, number>();
  private readonly batches: SpeciesBatch[] = [];
  private readonly scratch = new Object3D();
  private readonly scratchColor = new Color();
  private tintTimer = 1;

  constructor(
    heightmap: Heightmap,
    biomes: BiomeMap,
    roads: RoadNetwork,
    buildings: BuildingSystem,
    seed: number,
  ) {
    this.group.name = 'vegetation';
    const rng = new Rng(seed ^ 0x5eed1234);
    const transforms = new Map<Species, PlantInstance[]>(SPECIES.map((s) => [s, []]));

    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        const type = (biomes.types[index] ?? Terrain.Grass) as Terrain;
        if (roads.has(tx, tz) || buildings.isOccupied(tx, tz)) continue;
        const table = TABLES[type];
        if (!table) continue;
        const slope = heightmap.slopeTan(tx, tz);
        const moisture = biomes.moisture[index] ?? 0.4;

        const roll = rng.next();
        let species: Species | null = null;
        let acc = 0;
        for (const [candidate, p] of table) {
          // Wetter ground grows denser timber; dry ground favours brush.
          const weight = candidate === 'aspen' || candidate === 'fir' ? p * (0.5 + moisture) : p;
          acc += weight;
          if (roll < acc) {
            species = candidate;
            break;
          }
        }
        if (!species) continue;
        const spec = SPEC[species];
        if (slope > spec.maxSlope) continue;

        const scale = spec.scale * rng.range(spec.scaleRange[0], spec.scaleRange[1]);
        const stretch = rng.range(spec.stretch[0], spec.stretch[1]);
        const worldX = (tx + 0.5 + rng.range(-spec.jitter, spec.jitter) * 0.5) * TILE_SIZE;
        const worldZ = (tz + 0.5 + rng.range(-spec.jitter, spec.jitter) * 0.5) * TILE_SIZE;
        // Sink trunks a little on banks so the downhill side never floats.
        const y = heightmap.heightAt(worldX, worldZ) - Math.min(0.3, slope * 0.22);
        // Per-instance colour drift as a multiplicative RGB bias: brightness,
        // a warm/cool hue lean, and a saturation push.
        const [dh, ds, dl] = spec.drift;
        const lightness = 1 + rng.range(-dl, dl);
        const warm = rng.range(-dh, dh) * 4;
        const sat = rng.range(-ds, ds);
        const tint = new Color(
          lightness * (1 + warm + sat * 0.5),
          lightness * (1 - Math.abs(warm) * 0.3),
          lightness * (1 - warm - sat * 0.5),
        );
        transforms.get(species)!.push({
          x: worldX,
          y,
          z: worldZ,
          scale,
          stretch,
          rotation: rng.range(0, Math.PI * 2),
          tilt: species === 'snag' ? rng.range(-0.08, 0.08) : rng.range(-0.035, 0.035),
          tile: index,
          tint,
        });
      }
    }

    const position = new Vector3();
    const quaternion = new Quaternion();
    const euler = new Euler();
    const scaleVec = new Vector3();
    for (const species of SPECIES) {
      const list = transforms.get(species) ?? [];
      if (list.length === 0) continue;
      const geometry = speciesGeometry(species);
      const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: species === 'rock' || species === 'boulders' ? 0.92 : 0.96,
        metalness: 0,
        flatShading: true,
      });
      const mesh = new InstancedMesh(geometry, material, list.length);
      mesh.name = `vegetation-${species}`;
      mesh.castShadow = SPEC[species].castShadow;
      mesh.receiveShadow = false;
      const records: InstanceRecord[] = [];
      list.forEach((instance, i) => {
        position.set(instance.x, instance.y, instance.z);
        euler.set(instance.tilt, instance.rotation, instance.tilt * 0.6);
        quaternion.setFromEuler(euler);
        scaleVec.set(instance.scale, instance.scale * instance.stretch, instance.scale);
        this.scratch.position.copy(position);
        this.scratch.quaternion.copy(quaternion);
        this.scratch.scale.copy(scaleVec);
        this.scratch.updateMatrix();
        mesh.setMatrixAt(i, this.scratch.matrix);
        mesh.setColorAt(i, instance.tint);
        records.push({ tile: instance.tile, tint: instance.tint });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.batches.push({ mesh, records, material });
      this.instancesBySpecies.set(species, list.length);
    }
  }

  get totalInstances(): number {
    let total = 0;
    for (const count of this.instancesBySpecies.values()) total += count;
    return total;
  }

  updateBurnTint(getState: (index: number) => number, dt: number): void {
    this.tintTimer -= dt;
    if (this.tintTimer > 0) return;
    this.tintTimer = 0.5;
    const color = this.scratchColor;
    for (const batch of this.batches) {
      for (let i = 0; i < batch.records.length; i += 1) {
        const record = batch.records[i];
        if (!record) continue;
        const state = getState(record.tile);
        let r = 1;
        let g = 1;
        let b = 1;
        if (state === 1 || state === 2) {
          r = 0.72;
          g = 0.5;
          b = 0.32;
        } else if (state === 3) {
          r = 0.44;
          g = 0.29;
          b = 0.18;
        } else if (state === 4) {
          r = 0.13;
          g = 0.11;
          b = 0.1;
        } else if (state === 5) {
          r = 0.9;
          g = 0.86;
          b = 0.66;
        }
        color.setRGB(record.tint.r * r, record.tint.g * g, record.tint.b * b);
        batch.mesh.setColorAt(i, color);
      }
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const batch of this.batches) {
      this.group.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      batch.material.dispose();
      batch.mesh.dispose();
    }
    this.batches.length = 0;
  }
}

function mergeParts(parts: Part[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    geometry.applyMatrix4(part.matrix);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const color = new Color(part.color);
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    geometry.dispose();
    part.geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const trs = (
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));

export function speciesGeometry(species: Species): BufferGeometry {
  switch (species) {
    case 'pine':
      // Ponderosa: tall bare trunk, stacked irregular whorls, slightly lopsided.
      return mergeParts([
        { geometry: new CylinderGeometry(0.11, 0.2, 2.2, 6), color: 0x6a4630, matrix: at(0, 1.1, 0) },
        { geometry: new ConeGeometry(1.08, 1.7, 7), color: 0x2f633d, matrix: trs(0.05, 2.15, 0, 0, 0.3) },
        { geometry: new ConeGeometry(0.9, 1.55, 7), color: 0x386f45, matrix: trs(-0.06, 2.95, 0.04, 0, 0.9) },
        { geometry: new ConeGeometry(0.66, 1.35, 7), color: 0x3f7a4b, matrix: trs(0.04, 3.7, -0.03, 0, 1.4) },
        { geometry: new ConeGeometry(0.38, 1.05, 6), color: 0x4a8653, matrix: at(0, 4.4, 0) },
      ]);
    case 'fir':
      // Subalpine fir: narrow dark spire with many short tiers.
      return mergeParts([
        { geometry: new CylinderGeometry(0.08, 0.15, 1.0, 5), color: 0x4f3626, matrix: at(0, 0.5, 0) },
        { geometry: new ConeGeometry(0.82, 1.3, 8), color: 0x1f4f3a, matrix: at(0, 1.35, 0) },
        { geometry: new ConeGeometry(0.7, 1.2, 8), color: 0x24583f, matrix: trs(0, 2.05, 0, 0, 0.4) },
        { geometry: new ConeGeometry(0.56, 1.1, 8), color: 0x2a6145, matrix: trs(0, 2.7, 0, 0, 0.8) },
        { geometry: new ConeGeometry(0.42, 1.0, 7), color: 0x2f6a4a, matrix: trs(0, 3.3, 0, 0, 1.2) },
        { geometry: new ConeGeometry(0.26, 0.95, 6), color: 0x36734f, matrix: at(0, 3.9, 0) },
      ]);
    case 'cypress':
      // Italian-cypress style column, planted in town yards.
      return mergeParts([
        { geometry: new CylinderGeometry(0.08, 0.12, 0.6, 5), color: 0x5a3e2a, matrix: at(0, 0.3, 0) },
        { geometry: new IcosahedronGeometry(0.5, 0), color: 0x2f5a3a, matrix: trs(0, 1.25, 0, 0, 0, 0, 1, 1.9, 1) },
        { geometry: new IcosahedronGeometry(0.38, 0), color: 0x356442, matrix: trs(0, 2.35, 0, 0, 0.5, 0, 1, 1.7, 1) },
      ]);
    case 'oak':
      // Valley oak: forked trunk, broad lumpy crown.
      return mergeParts([
        { geometry: new CylinderGeometry(0.17, 0.27, 1.5, 6), color: 0x5f4430, matrix: at(0, 0.75, 0) },
        { geometry: new CylinderGeometry(0.09, 0.14, 1.1, 5), color: 0x5f4430, matrix: trs(0.32, 1.75, 0, 0, 0, -0.55) },
        { geometry: new CylinderGeometry(0.09, 0.14, 1.0, 5), color: 0x5f4430, matrix: trs(-0.28, 1.7, 0.1, 0.2, 0, 0.6) },
        { geometry: new IcosahedronGeometry(1.0, 0), color: 0x4d8a43, matrix: trs(0, 2.65, 0, 0, 0, 0, 1.15, 0.85, 1.1) },
        { geometry: new IcosahedronGeometry(0.78, 0), color: 0x5a944a, matrix: at(0.8, 2.35, 0.25) },
        { geometry: new IcosahedronGeometry(0.72, 0), color: 0x447c3c, matrix: at(-0.7, 2.4, -0.3) },
        { geometry: new IcosahedronGeometry(0.6, 0), color: 0x52903f, matrix: at(0.1, 3.2, -0.45) },
      ]);
    case 'aspen':
      // Quaking aspen: slim white trunk with dark scars, small golden-green crown.
      return mergeParts([
        { geometry: new CylinderGeometry(0.07, 0.11, 2.6, 6), color: 0xe4e0d2, matrix: at(0, 1.3, 0) },
        { geometry: new CylinderGeometry(0.075, 0.075, 0.08, 6), color: 0x3a3632, matrix: at(0, 0.9, 0) },
        { geometry: new CylinderGeometry(0.07, 0.07, 0.07, 6), color: 0x3a3632, matrix: at(0, 1.6, 0) },
        { geometry: new IcosahedronGeometry(0.62, 0), color: 0x9fb84a, matrix: trs(0, 2.9, 0, 0, 0, 0, 0.9, 1.35, 0.9) },
        { geometry: new IcosahedronGeometry(0.44, 0), color: 0xc4c25a, matrix: at(0.35, 2.55, 0.12) },
        { geometry: new IcosahedronGeometry(0.4, 0), color: 0x8aab45, matrix: at(-0.3, 3.35, -0.1) },
      ]);
    case 'snag':
      // Fire-killed standing snag: grey bleached trunk, a few broken limbs.
      return mergeParts([
        { geometry: new CylinderGeometry(0.06, 0.2, 3.6, 6), color: 0x8a8278, matrix: at(0, 1.8, 0) },
        { geometry: new CylinderGeometry(0.03, 0.06, 1.0, 4), color: 0x7a7268, matrix: trs(0.32, 2.4, 0, 0, 0, -1.0) },
        { geometry: new CylinderGeometry(0.03, 0.05, 0.8, 4), color: 0x7a7268, matrix: trs(-0.26, 2.9, 0.08, 0.3, 0, 0.95) },
        { geometry: new CylinderGeometry(0.02, 0.05, 0.7, 4), color: 0x7a7268, matrix: trs(0.05, 1.7, -0.25, 1.0, 0, 0) },
        { geometry: new CylinderGeometry(0.21, 0.24, 0.25, 6), color: 0x2e2a26, matrix: at(0, 0.12, 0) },
      ]);
    case 'manzanita':
      // Manzanita: twisted red-barked stems under a flat olive canopy.
      return mergeParts([
        { geometry: new CylinderGeometry(0.06, 0.1, 1.1, 5), color: 0x8b3a24, matrix: trs(0.15, 0.5, 0, 0, 0, -0.35) },
        { geometry: new CylinderGeometry(0.05, 0.09, 1.0, 5), color: 0x9a4229, matrix: trs(-0.18, 0.45, 0.1, 0.25, 0, 0.4) },
        { geometry: new CylinderGeometry(0.05, 0.08, 0.9, 5), color: 0x8b3a24, matrix: trs(0, 0.45, -0.2, -0.4, 0, 0) },
        { geometry: new IcosahedronGeometry(0.7, 0), color: 0x7f8f4c, matrix: trs(0.2, 1.05, 0, 0, 0, 0, 1.2, 0.55, 1.0) },
        { geometry: new IcosahedronGeometry(0.55, 0), color: 0x6f8043, matrix: trs(-0.35, 0.95, 0.15, 0, 0.6, 0, 1.1, 0.6, 1.0) },
        { geometry: new IcosahedronGeometry(0.45, 0), color: 0x8a9a55, matrix: trs(0, 1.0, -0.4, 0, 0, 0, 1.0, 0.6, 1.0) },
      ]);
    case 'shrub':
      return mergeParts([
        { geometry: new IcosahedronGeometry(0.6, 0), color: 0x7d8a42, matrix: trs(0, 0.42, 0, 0, 0, 0, 1.3, 0.72, 1.2) },
        { geometry: new IcosahedronGeometry(0.48, 0), color: 0x8e984b, matrix: at(0.55, 0.32, 0.15) },
        { geometry: new IcosahedronGeometry(0.4, 0), color: 0x6e7d39, matrix: at(-0.45, 0.26, -0.25) },
      ]);
    case 'tuft': {
      // Dry bunchgrass: a fan of thin golden blades.
      const parts: Part[] = [];
      const blades = 7;
      for (let i = 0; i < blades; i += 1) {
        const angle = (i / blades) * Math.PI * 2;
        const lean = 0.35 + (i % 3) * 0.12;
        parts.push({
          geometry: new ConeGeometry(0.07, 0.75 - (i % 2) * 0.18, 3),
          color: i % 3 === 0 ? 0xc7ad62 : i % 3 === 1 ? 0xb39a55 : 0xa8a35a,
          matrix: trs(Math.sin(angle) * 0.12, 0.3, Math.cos(angle) * 0.12, Math.cos(angle) * lean, 0, -Math.sin(angle) * lean),
        });
      }
      return mergeParts(parts);
    }
    case 'flowers': {
      // Lupine / poppy patch: green mound with coloured spikes.
      const parts: Part[] = [
        { geometry: new IcosahedronGeometry(0.32, 0), color: 0x5f8a45, matrix: trs(0, 0.12, 0, 0, 0, 0, 1.6, 0.5, 1.4) },
      ];
      const blooms = [0x7c6bd0, 0xe8963a, 0x8e7ad8, 0xf0b640, 0x6f5fc4];
      for (let i = 0; i < blooms.length; i += 1) {
        const angle = (i / blooms.length) * Math.PI * 2 + 0.4;
        parts.push({
          geometry: new ConeGeometry(0.06, 0.32, 4),
          color: blooms[i] as number,
          matrix: at(Math.sin(angle) * 0.28, 0.32, Math.cos(angle) * 0.24),
        });
      }
      return mergeParts(parts);
    }
    case 'rock':
      return mergeParts([
        { geometry: new DodecahedronGeometry(0.72, 0), color: 0x8d8a82, matrix: trs(0, 0.38, 0, 0.3, 0.7, 0.1, 1.2, 0.75, 1.0) },
      ]);
    case 'boulders':
      return mergeParts([
        { geometry: new DodecahedronGeometry(0.7, 0), color: 0x8f8a80, matrix: trs(0, 0.4, 0, 0.2, 0.4, 0.1, 1.15, 0.85, 1.0) },
        { geometry: new OctahedronGeometry(0.5, 0), color: 0x7d786f, matrix: trs(0.75, 0.25, 0.3, 0.4, 1.1, 0.2, 1.0, 0.7, 1.1) },
        { geometry: new DodecahedronGeometry(0.38, 0), color: 0x9b958a, matrix: trs(-0.6, 0.2, 0.45, 0.6, 0.2, 0.3, 1.0, 0.8, 0.9) },
        { geometry: new IcosahedronGeometry(0.42, 0), color: 0x6f8043, matrix: trs(-0.2, 0.15, -0.65, 0, 0, 0, 1.3, 0.5, 1.1) },
      ]);
    case 'log':
      // Fallen log with a root plate and a mossy top.
      return mergeParts([
        { geometry: new CylinderGeometry(0.2, 0.24, 2.6, 7), color: 0x6b4a32, matrix: trs(0, 0.2, 0, 0, 0, Math.PI / 2) },
        { geometry: new CylinderGeometry(0.45, 0.45, 0.14, 7), color: 0x584030, matrix: trs(-1.32, 0.32, 0, 0, 0, Math.PI / 2) },
        { geometry: new IcosahedronGeometry(0.26, 0), color: 0x5d7f3e, matrix: trs(0.3, 0.38, 0, 0, 0, 0, 2.2, 0.35, 0.8) },
      ]);
  }
}
