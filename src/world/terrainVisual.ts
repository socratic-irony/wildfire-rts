import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { lerp } from '../core/math';
import { hash2, Rng } from '../core/rng';
import { GRID_SIZE, TILE_SIZE, tileIndex } from './constants';
import { Heightmap, WATER_LEVEL } from './heightmap';
import { BiomeMap, TERRAIN_COLORS, Terrain } from './biomes';

export class TerrainVisual {
  readonly group = new Group();
  readonly mesh: Mesh;
  private readonly baseColors: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly waterMesh: Mesh;
  private burnedTimer = 1;

  constructor(
    heightmap: Heightmap,
    biomes: BiomeMap,
  ) {
    this.group.name = 'terrain';
    this.geometry = buildTerrainGeometry(heightmap, biomes, heightmap.seed);
    this.baseColors = new Float32Array(this.geometry.getAttribute('color').array);
    this.colors = this.geometry.getAttribute('color').array as Float32Array;
    const material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = 'terrain-surface';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    this.waterMesh = buildWaterMesh(heightmap);
    this.group.add(this.waterMesh);
    this.group.add(buildBackdrop(heightmap.seed));
  }

  updateBurnTint(states: Uint8Array, dt: number, wetness?: Float32Array, retardant?: Float32Array): void {
    this.burnedTimer -= dt;
    if (this.burnedTimer > 0) return;
    this.burnedTimer = 0.5;
    const target = new Color();
    for (let tile = 0; tile < GRID_SIZE * GRID_SIZE; tile += 1) {
      const state = states[tile] ?? 0;
      const baseIndex = tile * 18;
      if (state === 0) {
        const wet = wetness?.[tile] ?? 0;
        const ret = retardant?.[tile] ?? 0;
        if (wet < 0.035 && ret < 0.035) {
          const base = this.baseColors;
          for (let i = 0; i < 18; i += 1) this.colors[baseIndex + i] = base[baseIndex + i] ?? 0;
          continue;
        }
        if (ret >= wet) target.setRGB(0.6, 0.35, 0.2);
        else target.setRGB(0.34, 0.48, 0.55);
      } else if (state === 1 || state === 2) target.setRGB(0.2, 0.13, 0.09);
      else if (state === 3) target.setRGB(0.16, 0.11, 0.08);
      else if (state === 4) target.setRGB(0.075, 0.06, 0.055);
      else target.setRGB(0.56, 0.48, 0.32);
      const wet = wetness?.[tile] ?? 0;
      const ret = retardant?.[tile] ?? 0;
      const strength = state === 5 ? 0.82 : state === 1 || state === 2 ? 0.68 : state === 0 ? Math.max(wet * 0.3, ret * 0.46) : 0.9;
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const offset = baseIndex + vertex * 3;
        this.colors[offset] = lerp(this.baseColors[offset] ?? 0, target.r, strength);
        this.colors[offset + 1] = lerp(this.baseColors[offset + 1] ?? 0, target.g, strength);
        this.colors[offset + 2] = lerp(this.baseColors[offset + 2] ?? 0, target.b, strength);
      }
    }
    const colorAttribute = this.geometry.getAttribute('color');
    colorAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.waterMesh.geometry.dispose();
    const waterMaterial = this.waterMesh.material;
    if (Array.isArray(waterMaterial)) for (const material of waterMaterial) material.dispose();
    else waterMaterial.dispose();
  }
}

function buildTerrainGeometry(heightmap: Heightmap, biomes: BiomeMap, seed: number): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new Color();
  const slopeColor = new Color(0x8a7a5b);
  const rockColor = new Color(0x77746b);
  const waterBed = new Color(0x5e6652);

  for (let tz = 0; tz < GRID_SIZE; tz += 1) {
    for (let tx = 0; tx < GRID_SIZE; tx += 1) {
      const index = tileIndex(tx, tz);
      const type = (biomes.types[index] ?? Terrain.Grass) as Terrain;
      const x0 = tx * TILE_SIZE;
      const x1 = (tx + 1) * TILE_SIZE;
      const z0 = tz * TILE_SIZE;
      const z1 = (tz + 1) * TILE_SIZE;
      const y00 = heightmap.vertexHeight(tx, tz);
      const y10 = heightmap.vertexHeight(tx + 1, tz);
      const y01 = heightmap.vertexHeight(tx, tz + 1);
      const y11 = heightmap.vertexHeight(tx + 1, tz + 1);
      const variation = (hash2(tx, tz, seed + 19) / 0xffffffff - 0.5) * 0.09;
      const slope = heightmap.slopeTan(tx, tz);
      if (type === Terrain.Water) {
        color.copy(waterBed).offsetHSL(0, 0, variation * 0.5);
      } else if (slope > 0.45) {
        color.copy(rockColor).lerp(slopeColor, 0.25 + (variation + 0.05) * 1.8);
      } else if (slope > 0.18) {
        color.setHex(TERRAIN_COLORS[type]).lerp(slopeColor, 0.42);
        color.offsetHSL(0, 0, variation);
      } else {
        color.setHex(TERRAIN_COLORS[type]);
        color.offsetHSL(0, variation * 0.7, variation);
      }
      const c = [color.r, color.g, color.b];
      positions.push(x0, y00, z0, x0, y01, z1, x1, y10, z0, x1, y10, z0, x0, y01, z1, x1, y11, z1);
      for (let i = 0; i < 6; i += 1) colors.push(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildWaterMesh(heightmap: Heightmap): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let tz = 0; tz < GRID_SIZE; tz += 1) {
    for (let tx = 0; tx < GRID_SIZE; tx += 1) {
      if (!heightmap.isWater(tx, tz)) continue;
      const x0 = tx * TILE_SIZE;
      const x1 = (tx + 1) * TILE_SIZE;
      const z0 = tz * TILE_SIZE;
      const z1 = (tz + 1) * TILE_SIZE;
      const y = WATER_LEVEL;
      positions.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
      for (let i = 0; i < 6; i += 1) normals.push(0, 1, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  const material = new MeshStandardMaterial({
    color: 0x3c8fb0,
    roughness: 0.2,
    metalness: 0.18,
    transparent: true,
    opacity: 0.84,
    flatShading: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'lake';
  mesh.receiveShadow = true;
  return mesh;
}

function buildBackdrop(seed: number): Group {
  const group = new Group();
  group.name = 'backdrop';
  const base = new Mesh(
    new PlaneGeometry(620, 620),
    new MeshStandardMaterial({ color: 0x2f4632, roughness: 1, metalness: 0 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(96, -1.4, 96);
  base.receiveShadow = false;
  group.add(base);

  const rng = new Rng(seed ^ 0xdecafbad);
  const mountainGeometry = new ConeGeometry(1, 1, 5);
  const mountainMaterial = new MeshStandardMaterial({
    color: 0x4e6155,
    roughness: 1,
    flatShading: true,
  });
  const count = 34;
  const mountains = new InstancedMesh(mountainGeometry, mountainMaterial, count);
  const dummy = new Object3D();
  const center = 96;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const radius = rng.range(180, 260);
    const height = rng.range(30, 78);
    const width = rng.range(28, 66);
    dummy.position.set(center + Math.cos(angle) * radius, height / 2 - 1.3, center + Math.sin(angle) * radius);
    dummy.rotation.set(0, rng.range(0, Math.PI), 0);
    dummy.scale.set(width, height, width * rng.range(0.8, 1.2));
    dummy.updateMatrix();
    mountains.setMatrixAt(i, dummy.matrix);
  }
  mountains.instanceMatrix.needsUpdate = true;
  mountains.castShadow = false;
  mountains.receiveShadow = false;
  group.add(mountains);
  return group;
}
