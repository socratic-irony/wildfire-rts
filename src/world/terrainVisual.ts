import {
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { clamp, lerp } from '../core/math';
import { hash2, Rng } from '../core/rng';
import { GRID_SIZE, TILE_SIZE, tileIndex } from './constants';
import { Heightmap, WATER_LEVEL } from './heightmap';
import { BiomeMap, TERRAIN_COLORS, Terrain } from './biomes';

export class TerrainVisual {
  readonly group = new Group();
  readonly mesh: Mesh;
  private baseColors: Float32Array;
  private colors: Float32Array;
  private geometry: BufferGeometry;
  private waterMesh: Mesh;
  private skirtMesh: Mesh;
  private burnedTimer = 1;

  constructor(
    private readonly heightmap: Heightmap,
    private readonly biomes: BiomeMap,
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
    this.skirtMesh = buildSkirtMesh(heightmap);
    this.group.add(this.skirtMesh);
    this.group.add(buildBackdrop(heightmap.seed));
  }

  /** Re-mesh after the heightmap was regraded (e.g. a new road cut). */
  rebuild(): void {
    const next = buildTerrainGeometry(this.heightmap, this.biomes, this.heightmap.seed);
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
    this.baseColors = new Float32Array(next.getAttribute('color').array);
    this.colors = next.getAttribute('color').array as Float32Array;
    this.burnedTimer = 0;
    for (const old of [this.waterMesh, this.skirtMesh]) {
      this.group.remove(old);
      old.geometry.dispose();
      (old.material as MeshStandardMaterial).dispose();
    }
    this.waterMesh = buildWaterMesh(this.heightmap);
    this.skirtMesh = buildSkirtMesh(this.heightmap);
    this.group.add(this.waterMesh, this.skirtMesh);
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
    for (const mesh of [this.waterMesh, this.skirtMesh]) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
  }
}

/** Exposed earth/stone layers, cycled by terrace level so banks read as strata. */
const EARTH_STRATA = [0xa07f55, 0x8b6c48, 0xb09166].map((hex) => new Color(hex));
const STONE_STRATA = [0x958f84, 0x7f7a71, 0xa39c8e].map((hex) => new Color(hex));
/** How much of a bank keeps its plant cover, per terrain type. */
const BANK_COVER: Partial<Record<Terrain, number>> = {
  [Terrain.Grass]: 0.62,
  [Terrain.Forest]: 0.66,
  [Terrain.Brush]: 0.5,
  [Terrain.Urban]: 0.45,
  [Terrain.Rock]: 0.08,
};

function buildTerrainGeometry(heightmap: Heightmap, biomes: BiomeMap, seed: number): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new Color();
  const cover = new Color();
  const waterBed = new Color(0x5e6652);
  const pushColor = (c: Color, count: number) => {
    for (let i = 0; i < count; i += 1) colors.push(c.r, c.g, c.b);
  };
  const bankColor = (type: Terrain, minHeight: number, tx: number, tz: number, salt: number, steep: boolean) => {
    const level = Math.round(minHeight / heightmap.levelHeight);
    const strata = type === Terrain.Rock || steep ? STONE_STRATA : EARTH_STRATA;
    const stratum = strata[((level % strata.length) + strata.length) % strata.length] as Color;
    const jitter = hash2(tx * 3 + salt, tz * 5 - salt, seed + 211) / 0xffffffff;
    const coverage = clamp((BANK_COVER[type] ?? 0.5) - (steep ? 0.25 : 0) + (jitter - 0.5) * 0.35, 0, 1);
    cover.setHex(TERRAIN_COLORS[type]).multiplyScalar(0.84);
    color.copy(stratum).lerp(cover, coverage).offsetHSL(0, 0, (jitter - 0.5) * 0.05);
    return color;
  };

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
      positions.push(x0, y00, z0, x0, y01, z1, x1, y10, z0, x1, y10, z0, x0, y01, z1, x1, y11, z1);
      if (type === Terrain.Water) {
        color.copy(waterBed).offsetHSL(0, 0, variation * 0.5);
        pushColor(color, 6);
      } else if (slope > 0.18) {
        // Two triangles, each coloured from its own terrace band.
        const steep = slope > 1.2;
        const triA = Math.min(y00, y01, y10);
        const triB = Math.min(y10, y01, y11);
        const flatA = y00 === y01 && y01 === y10;
        const flatB = y10 === y01 && y01 === y11;
        if (flatA) color.setHex(TERRAIN_COLORS[type]).offsetHSL(0, variation * 0.7, variation);
        else bankColor(type, triA, tx, tz, 1, steep);
        pushColor(color, 3);
        if (flatB) color.setHex(TERRAIN_COLORS[type]).offsetHSL(0, variation * 0.7, variation);
        else bankColor(type, triB, tx, tz, 2, steep);
        pushColor(color, 3);
      } else {
        color.setHex(TERRAIN_COLORS[type]);
        color.offsetHSL(0, variation * 0.7, variation);
        pushColor(color, 6);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Vertical earth walls around the map edge so the diorama reads as a cut block. */
function buildSkirtMesh(heightmap: Heightmap): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const bottom = -1.4;
  const color = new Color();
  const edge = (ax: number, az: number, bx: number, bz: number, ha: number, hb: number, i: number) => {
    positions.push(ax, ha, az, ax, bottom, az, bx, hb, bz, bx, hb, bz, ax, bottom, az, bx, bottom, bz);
    const level = Math.round(Math.min(ha, hb) / heightmap.levelHeight);
    color.copy(EARTH_STRATA[level % EARTH_STRATA.length] as Color).multiplyScalar(0.78 + (i % 3) * 0.03);
    for (let k = 0; k < 6; k += 1) colors.push(color.r, color.g, color.b);
  };
  const n = GRID_SIZE;
  for (let i = 0; i < n; i += 1) {
    const a = i * TILE_SIZE;
    const b = (i + 1) * TILE_SIZE;
    const max = n * TILE_SIZE;
    edge(b, 0, a, 0, heightmap.vertexHeight(i + 1, 0), heightmap.vertexHeight(i, 0), i);
    edge(a, max, b, max, heightmap.vertexHeight(i, n), heightmap.vertexHeight(i + 1, n), i);
    edge(0, a, 0, b, heightmap.vertexHeight(0, i), heightmap.vertexHeight(0, i + 1), i);
    edge(max, b, max, a, heightmap.vertexHeight(n, i + 1), heightmap.vertexHeight(n, i), i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain-skirt';
  return mesh;
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
