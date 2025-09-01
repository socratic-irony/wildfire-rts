import { Group, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { FireGrid } from '../fire/grid';
import { FireState } from '../fire/grid';
import { InstancedParticleSystem } from './system';

export type ParticleQuality = 'low' | 'med' | 'high';

function fuelMultipliers(fuel: string) {
  // multipliers for rates and sizes by fuel
  if (fuel === 'forest') return { flame: 1.4, smoke: 1.6, smolder: 1.2, size: 1.2 };
  if (fuel === 'chaparral') return { flame: 1.0, smoke: 1.2, smolder: 1.0, size: 1.0 };
  if (fuel === 'grass') return { flame: 0.8, smoke: 0.7, smolder: 0.6, size: 0.8 };
  return { flame: 0.0, smoke: 0.0, smolder: 0.0, size: 1.0 };
}

function randHash(i: number) {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 16; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 13; x = Math.imul(x, 0x27d4eb2d); x ^= x >>> 15;
  return (x >>> 0) / 0xffffffff;
}

export function createFireParticles(hm: Heightmap) {
  const group = new Group();
  const ico = new IcosahedronGeometry(0.5, 0); // base; scaled per instance

  // Flames use basic material to be bright and unaffected by lighting
  const flameMat = new MeshBasicMaterial({ color: 0xffffff });
  const smokeMat = new MeshBasicMaterial({ color: 0xffffff });
  const smoldMat = new MeshBasicMaterial({ color: 0xffffff });

  let caps = { flames: 1500, smoke: 2000, smolder: 1000 };
  const flames = new InstancedParticleSystem('flame', ico, flameMat, caps.flames);
  const smoke = new InstancedParticleSystem('smoke', ico, smokeMat, caps.smoke);
  const smold = new InstancedParticleSystem('smolder', ico, smoldMat, caps.smolder);
  group.add(flames.mesh, smoke.mesh, smold.mesh);
  flames.mesh.renderOrder = 10; smoke.mesh.renderOrder = 11; smold.mesh.renderOrder = 12;

  // Per-tile accumulators for emission
  let width = hm.width, height = hm.height;
  let accFlame = new Float32Array(width * height);
  let accSmoke = new Float32Array(width * height);
  let accSmold = new Float32Array(width * height);

  function resizeForHM(newHM: Heightmap) {
    width = newHM.width; height = newHM.height;
    accFlame = new Float32Array(width * height);
    accSmoke = new Float32Array(width * height);
    accSmold = new Float32Array(width * height);
  }

  function setQuality(q: ParticleQuality) {
    if (q === 'low') caps = { flames: 800, smoke: 1200, smolder: 600 };
    else if (q === 'high') caps = { flames: 3000, smoke: 3600, smolder: 1800 };
    else caps = { flames: 1500, smoke: 2000, smolder: 1000 };
    // Note: resizing existing InstancedMesh capacities is non-trivial; recreate later when needed.
  }

  function spawnFromTile(kind: 'flame' | 'smoke' | 'smolder', x: number, z: number, baseRate: number, heat: number, fuel: string) {
    const i = z * width + x;
    const fmul = fuelMultipliers(fuel);
    const scaleMul = fmul.size;
    const rateMul = (kind === 'flame' ? fmul.flame : kind === 'smoke' ? fmul.smoke : fmul.smolder);
    const R = baseRate * rateMul;
    const acc = kind === 'flame' ? accFlame : kind === 'smoke' ? accSmoke : accSmold;
    acc[i] += R; // dt will be applied at call site
    const worldX = (x + 0.5) * hm.scale;
    const worldZ = (z + 0.5) * hm.scale;
    const worldY = hm.sample(worldX, worldZ);
    // spawn loop: integer part = count
    const n = acc[i] | 0;
    if (n <= 0) return;
    acc[i] -= n;
    for (let k = 0; k < n; k++) {
      const h = randHash((i + 131 * k) | 0);
      const ox = (h * 2 - 1) * 0.3 * hm.scale;
      const oz = (((h * 65537) % 1) * 2 - 1) * 0.3 * hm.scale;
      const pos = { x: worldX + ox, y: worldY + 0.2, z: worldZ + oz };
      const up = kind === 'flame' ? 1.2 + 0.6 * heat : kind === 'smoke' ? 0.6 + 0.5 * heat : 0.25 + 0.2 * (1 - heat);
      const vel = { x: 0, y: up, z: 0 };
      if (kind === 'flame') {
        const life = 0.4 + 0.4 * Math.random();
        const s0 = (0.35 + 0.35 * Math.random()) * scaleMul;
        const s1 = (0.12 + 0.12 * Math.random()) * scaleMul;
        const c0: [number, number, number] = [1.0, 0.45 + 0.2 * heat, 0.08];
        const c1: [number, number, number] = [1.0, 0.7, 0.2];
        flames.spawnOne({ pos, vel, life, size0: s0, size1: s1, color0: c0, color1: c1 });
      } else if (kind === 'smoke') {
        const life = 3.0 + 2.0 * Math.random();
        const s0 = (0.5 + 0.4 * Math.random()) * scaleMul;
        const s1 = (2.0 + 2.0 * Math.random()) * scaleMul;
        const c0: [number, number, number] = [0.2, 0.18, 0.16];
        const c1: [number, number, number] = [0.6, 0.6, 0.6];
        smoke.spawnOne({ pos, vel, life, size0: s0, size1: s1, color0: c0, color1: c1 });
      } else {
        const life = 1.6 + 1.6 * Math.random();
        const s0 = (0.35 + 0.25 * Math.random()) * scaleMul;
        const s1 = (1.0 + 0.7 * Math.random()) * scaleMul;
        const c0: [number, number, number] = [0.7, 0.7, 0.7];
        const c1: [number, number, number] = [0.7, 0.7, 0.7];
        smold.spawnOne({ pos, vel, life, size0: s0, size1: s1, color0: c0, color1: c1 });
      }
    }
  }

  function update(grid: FireGrid, env: { windDirRad: number; windSpeed: number }, dt: number, camera: THREE.Camera) {
    if (grid.width !== width || grid.height !== height) resizeForHM(hm);
    const wx = Math.sin(env.windDirRad) * env.windSpeed;
    const wz = Math.cos(env.windDirRad) * env.windSpeed;
    const wind = { wx, wz };
    const baseFlame = 14.0 * dt; // hotter, more visible flames
    const baseSmoke = 5.0 * dt;
    const baseSmold = 2.5 * dt;

    // Spawn from Burning
    for (let bi = 0; bi < grid.bCount; bi++) {
      const idx = grid.burning[bi] | 0;
      const x = idx % grid.width; const z = (idx / grid.width) | 0;
      const t = grid.tiles[idx];
      const heat = t.heat;
      if (heat <= 0) continue;
      // LOD by distance
      const wxz = (x + 0.5) * hm.scale; const wzx = (z + 0.5) * hm.scale;
      const dx = (camera.position.x - wxz); const dz = (camera.position.z - wzx);
      const d2 = dx * dx + dz * dz;
      let lod = 1.0; if (d2 > 300 * 300) lod = 0.0; else if (d2 > 180 * 180) lod = 0.2; else if (d2 > 80 * 80) lod = 0.6;
      if (lod <= 0) continue;
      spawnFromTile('flame', x, z, baseFlame * (0.3 + 0.9 * heat) * lod, heat, t.fuel);
      spawnFromTile('smoke', x, z, baseSmoke * (0.4 + 1.1 * heat) * lod, heat, t.fuel);
    }
    // Spawn from Smoldering
    for (let si = 0; si < grid.sCount; si++) {
      const idx = grid.smoldering[si] | 0;
      const x = idx % grid.width; const z = (idx / grid.width) | 0;
      const t = grid.tiles[idx];
      const invHeat = 1 - t.heat;
      const wxz = (x + 0.5) * hm.scale; const wzx = (z + 0.5) * hm.scale;
      const dx = (camera.position.x - wxz); const dz = (camera.position.z - wzx);
      const d2 = dx * dx + dz * dz;
      let lod = 1.0; if (d2 > 300 * 300) lod = 0.0; else if (d2 > 180 * 180) lod = 0.3; else if (d2 > 80 * 80) lod = 0.6;
      if (lod <= 0) continue;
      spawnFromTile('smolder', x, z, baseSmold * Math.max(0.3, invHeat) * lod, t.heat, t.fuel);
    }

    // Light flames from Igniting tiles (small pop at the head/front)
    for (let ii = 0; ii < grid.iCount; ii++) {
      const idx = grid.igniting[ii] | 0;
      const x = idx % grid.width; const z = (idx / grid.width) | 0;
      const t = grid.tiles[idx];
      const wxz = (x + 0.5) * hm.scale; const wzx = (z + 0.5) * hm.scale;
      const dx = (camera.position.x - wxz); const dz = (camera.position.z - wzx);
      const d2 = dx * dx + dz * dz;
      let lod = 1.0; if (d2 > 300 * 300) lod = 0.0; else if (d2 > 180 * 180) lod = 0.2; else if (d2 > 80 * 80) lod = 0.5;
      if (lod <= 0) continue;
      spawnFromTile('flame', x, z, (0.4 * baseFlame) * lod, Math.max(0.4, t.heat), t.fuel);
    }

    // Integrate particles
    const slopeLift = 0; // could sample from grid tile slope later
    flames.update(dt, wind, slopeLift);
    smoke.update(dt, wind, slopeLift);
    smold.update(dt, wind, slopeLift);
  }

  function addToScene(root: THREE.Object3D) { (root as any).add(group); }
  function removeFromScene(root: THREE.Object3D) { (root as any).remove(group); }

  function dispose() { /* three handles freed by GC; keep for completeness */ }

  return { group, update, addToScene, removeFromScene, setQuality } as const;
}
