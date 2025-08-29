import { BufferGeometry, Float32BufferAttribute } from 'three';
import { Heightmap } from './heightmap';

export function buildTerrainGeometry(hm: Heightmap): BufferGeometry {
  const cols = hm.width + 1;
  const rows = hm.height + 1;
  const vertCount = cols * rows;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  let i3 = 0;
  let i2 = 0;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const y = hm.data[z * cols + x];
      positions[i3 + 0] = x * hm.scale;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z * hm.scale;
      uvs[i2 + 0] = x / hm.width;
      uvs[i2 + 1] = z / hm.height;
      i3 += 3;
      i2 += 2;
    }
  }

  const indices: number[] = [];
  for (let z = 0; z < hm.height; z++) {
    for (let x = 0; x < hm.width; x++) {
      const i0 = z * cols + x;
      const i1 = i0 + 1;
      const i2r = i0 + cols;
      const i3r = i2r + 1;
      indices.push(i0, i2r, i1, i1, i2r, i3r);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.boundingSphere = null; // let three compute lazily
  return geo;
}
