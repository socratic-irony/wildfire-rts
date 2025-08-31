import { BufferAttribute, BufferGeometry, Group, Material, Mesh } from 'three';
import { Heightmap } from './heightmap';
import { applyBiomeVertexColors, computeBiomes } from './biomes';

function buildChunkGeometry(
  hm: Heightmap,
  x0: number,
  z0: number,
  size: number,
  step: number,
  colors?: Float32Array
) {
  const w = Math.min(size, hm.width - x0);
  const h = Math.min(size, hm.height - z0);
  const cols = Math.floor(w / step) + 1;
  const rows = Math.floor(h / step) + 1;
  const baseVertCount = cols * rows;
  const positions = new Float32Array(baseVertCount * 3);
  const uvs = new Float32Array(baseVertCount * 2);
  const indices: number[] = [];
  let i3 = 0, i2 = 0;
  for (let rz = 0; rz < rows; rz++) {
    for (let rx = 0; rx < cols; rx++) {
      const gx = x0 + rx * step;
      const gz = z0 + rz * step;
      const y = hm.data[gz * (hm.width + 1) + gx];
      positions[i3++] = gx * hm.scale;
      positions[i3++] = y;
      positions[i3++] = gz * hm.scale;
      uvs[i2++] = gx / hm.width;
      uvs[i2++] = gz / hm.height;
    }
  }
  for (let rz = 0; rz < rows - 1; rz++) {
    for (let rx = 0; rx < cols - 1; rx++) {
      const i0 = rz * cols + rx;
      const i1 = i0 + 1;
      const i2r = i0 + cols;
      const i3r = i2r + 1;
      indices.push(i0, i2r, i1, i1, i2r, i3r);
    }
  }
  // Add subtle skirts along chunk edges to hide LOD cracks
  const SKIRT_DEPTH = hm.scale * 1.0;
  const skirtTopIdx: number[] = new Array(cols);
  const skirtBottomIdx: number[] = new Array(cols);
  const skirtLeftIdx: number[] = new Array(rows);
  const skirtRightIdx: number[] = new Array(rows);

  // Pre-allocate expanded arrays (base + all skirt vertices)
  const skirtVerts = 2 * (cols + rows);
  const pos2 = new Float32Array(positions.length + skirtVerts * 3);
  pos2.set(positions);
  const uv2 = new Float32Array(uvs.length + skirtVerts * 2);
  uv2.set(uvs);
  let col2: Float32Array | undefined;
  if (colors) {
    col2 = new Float32Array(colors.length + skirtVerts * 3);
    col2.set(colors);
  }
  let baseIdx = baseVertCount; // next new vertex index
  let p3 = positions.length;
  let u2 = uvs.length;

  // Helper to append a skirt vertex duplicating top's attributes but lowering Y
  const appendSkirtFrom = (topIndex: number): number => {
    const x = positions[topIndex * 3 + 0];
    const y = positions[topIndex * 3 + 1] - SKIRT_DEPTH;
    const z = positions[topIndex * 3 + 2];
    pos2[p3++] = x; pos2[p3++] = y; pos2[p3++] = z;
    uv2[u2++] = uvs[topIndex * 2 + 0];
    uv2[u2++] = uvs[topIndex * 2 + 1];
    if (col2 && colors) {
      col2[colors.length + (baseIdx - baseVertCount) * 3 + 0] = colors[topIndex * 3 + 0];
      col2[colors.length + (baseIdx - baseVertCount) * 3 + 1] = colors[topIndex * 3 + 1];
      col2[colors.length + (baseIdx - baseVertCount) * 3 + 2] = colors[topIndex * 3 + 2];
    }
    return baseIdx++;
  };

  // Top edge (rz = 0)
  for (let rx = 0; rx < cols; rx++) {
    const top = 0 * cols + rx;
    skirtTopIdx[rx] = appendSkirtFrom(top);
  }
  for (let rx = 0; rx < cols - 1; rx++) {
    const a = 0 * cols + rx;
    const b = 0 * cols + rx + 1;
    const sa = skirtTopIdx[rx];
    const sb = skirtTopIdx[rx + 1];
    indices.push(a, sa, sb, a, sb, b);
  }

  // Bottom edge (rz = rows - 1)
  for (let rx = 0; rx < cols; rx++) {
    const top = (rows - 1) * cols + rx;
    skirtBottomIdx[rx] = appendSkirtFrom(top);
  }
  for (let rx = 0; rx < cols - 1; rx++) {
    const a = (rows - 1) * cols + rx;
    const b = (rows - 1) * cols + rx + 1;
    const sa = skirtBottomIdx[rx];
    const sb = skirtBottomIdx[rx + 1];
    indices.push(a, sb, sa, a, b, sb);
  }

  // Left edge (rx = 0)
  for (let rz = 0; rz < rows; rz++) {
    const top = rz * cols + 0;
    skirtLeftIdx[rz] = appendSkirtFrom(top);
  }
  for (let rz = 0; rz < rows - 1; rz++) {
    const a = rz * cols + 0;
    const b = (rz + 1) * cols + 0;
    const sa = skirtLeftIdx[rz];
    const sb = skirtLeftIdx[rz + 1];
    indices.push(a, sb, sa, a, b, sb);
  }

  // Right edge (rx = cols - 1)
  for (let rz = 0; rz < rows; rz++) {
    const top = rz * cols + (cols - 1);
    skirtRightIdx[rz] = appendSkirtFrom(top);
  }
  for (let rz = 0; rz < rows - 1; rz++) {
    const a = rz * cols + (cols - 1);
    const b = (rz + 1) * cols + (cols - 1);
    const sa = skirtRightIdx[rz];
    const sb = skirtRightIdx[rz + 1];
    indices.push(a, sa, sb, a, sb, b);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos2, 3));
  geo.setAttribute('uv', new BufferAttribute(uv2, 2));
  geo.setIndex(indices);
  if (colors && col2) geo.setAttribute('color', new BufferAttribute(col2, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function buildChunkedTerrain(
  hm: Heightmap,
  material: Material,
  chunkSize = 32
) {
  const group = new Group();
  const biomes = computeBiomes(hm);

  const makeColors = (x0: number, z0: number, size: number, step: number) => {
    const cols = Math.floor(Math.min(size, hm.width - x0) / step) + 1;
    const rows = Math.floor(Math.min(size, hm.height - z0) / step) + 1;
    const colors = new Float32Array(cols * rows * 3);
    // Build a small temp heightmap view to reuse coloring logic
    // For simplicity, sample from the main precomputed biomes per vertex index
    // Map local (rx,rz) -> global index
    for (let rz = 0; rz < rows; rz++) {
      for (let rx = 0; rx < cols; rx++) {
        const gx = x0 + rx * step;
        const gz = z0 + rz * step;
        const gi = gz * (hm.width + 1) + gx;
        const i = rz * cols + rx;
        const r = biomes.rock[gi] ? 1 : 0;
        const f = biomes.forest[gi] ? 1 : 0;
        const c = biomes.chaparral[gi] ? 1 : 0;
        const rockCol = [0.60, 0.55, 0.60];
        const forestCol = [0.17, 0.43, 0.29];
        const chapCol = [0.76, 0.70, 0.50];
        const sum = r + f + c || 1;
        const R = (r * rockCol[0] + f * forestCol[0] + c * chapCol[0]) / sum;
        const G = (r * rockCol[1] + f * forestCol[1] + c * chapCol[1]) / sum;
        const B = (r * rockCol[2] + f * forestCol[2] + c * chapCol[2]) / sum;
        colors[i * 3 + 0] = R;
        colors[i * 3 + 1] = G;
        colors[i * 3 + 2] = B;
      }
    }
    return colors;
  };

  for (let z0 = 0; z0 < hm.height; z0 += chunkSize) {
    for (let x0 = 0; x0 < hm.width; x0 += chunkSize) {
      const colorsHi = makeColors(x0, z0, chunkSize, 1);
      const geoHi = buildChunkGeometry(hm, x0, z0, chunkSize, 1, colorsHi);
      const colorsLo = makeColors(x0, z0, chunkSize, 2);
      const geoLo = buildChunkGeometry(hm, x0, z0, chunkSize, 2, colorsLo);
      const mesh = new Mesh(geoHi, material);
      (mesh as any).userData.geoHi = geoHi;
      (mesh as any).userData.geoLo = geoLo;
      (mesh as any).userData.cx = (x0 + Math.min(chunkSize, hm.width - x0) * 0.5) * hm.scale;
      (mesh as any).userData.cz = (z0 + Math.min(chunkSize, hm.height - z0) * 0.5) * hm.scale;
      // preserve base colors for vertex-tint visualization
      (mesh as any).userData.baseColorsHi = colorsHi.slice();
      (mesh as any).userData.baseColorsLo = colorsLo.slice();
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  const updateLOD = (camX: number, camZ: number) => {
    const nearDist = 80;
    const farDist = 180;
    for (const m of group.children as Mesh[]) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const pos = m.geometry.boundingSphere?.center;
      const cx = (m as any).userData.cx ?? pos?.x ?? 0;
      const cz = (m as any).userData.cz ?? pos?.z ?? 0;
      const dx = cx - camX;
      const dz = cz - camZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > farDist * farDist) {
        m.visible = false;
      } else {
        m.visible = true;
        m.geometry = d2 > nearDist * nearDist ? (m as any).userData.geoLo : (m as any).userData.geoHi;
      }
    }
  };

  return { group, updateLOD };
}
