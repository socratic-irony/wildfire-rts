import { describe, it, expect } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { generateHeightmap } from '../terrain/heightmap';
import { buildTerrainGeometry } from '../terrain/mesh';
import { buildChunkedTerrain } from '../terrain/chunks';

describe('terrain mesh builder', () => {
  it('produces correct vertex and index counts', () => {
    const hm = generateHeightmap(8, 4, 1, {
      seed: 1,
      frequency: 1,
      amplitude: 1,
      octaves: 2,
      persistence: 0.5,
    });
    const geo = buildTerrainGeometry(hm);
    const cols = hm.width + 1;
    const rows = hm.height + 1;
    expect(geo.getAttribute('position').count).toBe(cols * rows);
    expect(geo.getIndex()!.count).toBe(hm.width * hm.height * 6);
    // Corner UVs
    const uv = geo.getAttribute('uv');
    expect(uv.getX(0)).toBeCloseTo(0);
    expect(uv.getY(0)).toBeCloseTo(0);
    const last = cols * rows - 1;
    expect(uv.getX(last)).toBeCloseTo(1);
    expect(uv.getY(last)).toBeCloseTo(1);
  });
});

describe('chunked terrain LOD switching', () => {
  it('switches between hi/lo geometry and visibility by distance', () => {
    const hm = generateHeightmap(64, 64, 1, {
      seed: 2,
      frequency: 1.2,
      amplitude: 5,
      octaves: 3,
      persistence: 0.5,
    });
    const mat = new MeshStandardMaterial();
    const chunked = buildChunkedTerrain(hm, mat, 16);
    // Ensure bounding spheres exist on both LOD geos
    const mesh = chunked.group.children[0] as any;
    mesh.userData.geoHi.computeBoundingSphere();
    mesh.userData.geoLo.computeBoundingSphere();
    const center = mesh.userData.geoHi.boundingSphere.center;

    // Near: hi LOD
    chunked.updateLOD(center.x, center.z);
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry).toBe(mesh.userData.geoHi);

    // Mid distance: lo LOD
    chunked.updateLOD(center.x + 120, center.z);
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry).toBe(mesh.userData.geoLo);

    // Far: invisible
    chunked.updateLOD(center.x + 1000, center.z);
    expect(mesh.visible).toBe(false);
  });
});

