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
  variation: number;
}

interface SpeciesBatch {
  mesh: InstancedMesh;
  records: InstanceRecord[];
  material: MeshStandardMaterial;
}

export type Species = 'pine' | 'oak' | 'shrub' | 'rock';

export class VegetationSystem {
  readonly group = new Group();
  readonly instancesBySpecies = new Map<Species, number>();
  private readonly batches: SpeciesBatch[] = [];
  private readonly scratch = new Object3D();
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
    const transforms: Record<Species, Array<{ x: number; y: number; z: number; scale: number; rotation: number; tile: number; variation: number }>> = {
      pine: [],
      oak: [],
      shrub: [],
      rock: [],
    };

    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        const type = biomes.types[index] ?? Terrain.Grass;
        if (type === Terrain.Water || type === Terrain.Urban || type === Terrain.Road) continue;
        if (!roads.has(tx, tz) && buildings.isOccupied(tx, tz)) continue;
        if (roads.has(tx, tz)) continue;
        const slope = heightmap.slopeTan(tx, tz);
        if (slope > 0.95) continue;

        let species: Species | null = null;
        const roll = rng.next();
        if (type === Terrain.Forest) {
          if (roll < 0.56) species = roll < 0.31 ? 'pine' : 'oak';
          else if (roll < 0.65) species = 'shrub';
        } else if (type === Terrain.Brush) {
          if (roll < 0.27) species = 'shrub';
          else if (roll < 0.33) species = 'oak';
          else if (roll < 0.36) species = 'rock';
        } else if (type === Terrain.Grass) {
          if (roll < 0.034) species = 'oak';
          else if (roll < 0.058) species = 'shrub';
          else if (roll < 0.072) species = 'rock';
        } else if (type === Terrain.Rock) {
          if (roll < 0.08) species = 'rock';
          else if (roll < 0.1) species = 'shrub';
        }
        if (!species) continue;

        const scaleBase = species === 'shrub' ? 0.62 : species === 'rock' ? 0.7 : 0.9;
        const scale = scaleBase * rng.range(0.72, 1.34);
        const jitter = species === 'rock' ? 0.55 : 0.78;
        const worldX = (tx + 0.5 + rng.range(-jitter, jitter)) * TILE_SIZE;
        const worldZ = (tz + 0.5 + rng.range(-jitter, jitter)) * TILE_SIZE;
        const y = heightmap.heightAt(worldX, worldZ);
        transforms[species].push({
          x: worldX,
          y,
          z: worldZ,
          scale,
          rotation: rng.range(0, Math.PI * 2),
          tile: index,
          variation: rng.range(0.82, 1.12),
        });
      }
    }

    for (const species of ['pine', 'oak', 'shrub', 'rock'] as const) {
      const list = transforms[species];
      if (list.length === 0) continue;
      const geometry = speciesGeometry(species);
      const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
        flatShading: true,
      });
      const mesh = new InstancedMesh(geometry, material, list.length);
      mesh.name = `vegetation-${species}`;
      mesh.castShadow = species !== 'shrub';
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      const records: InstanceRecord[] = [];
      const color = new Color();
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scaleVec = new Vector3();
      list.forEach((instance, i) => {
        position.set(instance.x, instance.y, instance.z);
        quaternion.setFromAxisAngle(new Vector3(0, 1, 0), instance.rotation);
        scaleVec.setScalar(instance.scale);
        this.scratch.position.copy(position);
        this.scratch.quaternion.copy(quaternion);
        this.scratch.scale.copy(scaleVec);
        this.scratch.updateMatrix();
        mesh.setMatrixAt(i, this.scratch.matrix);
        const tint = instance.variation;
        if (species === 'rock') color.setRGB(tint * 0.92, tint * 0.9, tint * 0.86);
        else color.setRGB(tint, tint, tint);
        mesh.setColorAt(i, color);
        records.push({ tile: instance.tile, variation: tint });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
    const color = new Color();
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
        color.setRGB(record.variation * r, record.variation * g, record.variation * b);
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
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

function speciesGeometry(species: Species): BufferGeometry {
  if (species === 'pine') {
    const parts: Part[] = [
      {
        geometry: new CylinderGeometry(0.12, 0.18, 1.5, 5),
        color: 0x5b3c28,
        matrix: new Matrix4().makeTranslation(0, 0.75, 0),
      },
      {
        geometry: new ConeGeometry(1.05, 2.1, 7),
        color: 0x2e653e,
        matrix: new Matrix4().makeTranslation(0, 2.15, 0),
      },
      {
        geometry: new ConeGeometry(0.78, 1.8, 7),
        color: 0x397547,
        matrix: new Matrix4().makeTranslation(0, 3.15, 0),
      },
      {
        geometry: new ConeGeometry(0.48, 1.45, 7),
        color: 0x417f4c,
        matrix: new Matrix4().makeTranslation(0, 4.05, 0),
      },
    ];
    return mergeParts(parts);
  }
  if (species === 'oak') {
    const parts: Part[] = [
      {
        geometry: new CylinderGeometry(0.17, 0.25, 1.9, 5),
        color: 0x65452c,
        matrix: new Matrix4().makeTranslation(0, 0.95, 0),
      },
      {
        geometry: new IcosahedronGeometry(1.05, 0),
        color: 0x4d8a43,
        matrix: new Matrix4().makeTranslation(0, 2.65, 0),
      },
      {
        geometry: new IcosahedronGeometry(0.78, 0),
        color: 0x5a944a,
        matrix: new Matrix4().makeTranslation(0.72, 2.3, 0.2),
      },
      {
        geometry: new IcosahedronGeometry(0.7, 0),
        color: 0x447c3c,
        matrix: new Matrix4().makeTranslation(-0.6, 2.35, -0.3),
      },
    ];
    return mergeParts(parts);
  }
  if (species === 'shrub') {
    const parts: Part[] = [
      {
        geometry: new IcosahedronGeometry(0.6, 0),
        color: 0x7d8a42,
        matrix: new Matrix4().compose(
          new Vector3(0, 0.42, 0),
          new Quaternion(),
          new Vector3(1.3, 0.72, 1.2),
        ),
      },
      {
        geometry: new IcosahedronGeometry(0.48, 0),
        color: 0x8e984b,
        matrix: new Matrix4().makeTranslation(0.55, 0.32, 0.15),
      },
      {
        geometry: new IcosahedronGeometry(0.4, 0),
        color: 0x6e7d39,
        matrix: new Matrix4().makeTranslation(-0.45, 0.26, -0.25),
      },
    ];
    return mergeParts(parts);
  }
  return mergeParts([
    {
      geometry: new DodecahedronGeometry(0.72, 0),
      color: 0x8d8a82,
      matrix: new Matrix4().compose(
        new Vector3(0, 0.38, 0),
        new Quaternion().setFromEuler(new Euler(0.3, 0.7, 0.1)),
        new Vector3(1.2, 0.75, 1.0),
      ),
    },
  ]);
}
