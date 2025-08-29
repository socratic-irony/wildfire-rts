import { Group, Mesh, Object3D } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { FireGrid } from './grid';
import { createFireOverlay } from './overlay';

export type FireVizMode = 'overlay' | 'raised' | 'vertex';

export function createFireViz(hm: Heightmap, chunkGroup: Group) {
  // Overlay instance shared for overlay/raised
  const overlay = createFireOverlay(hm);
  let mode: FireVizMode = 'overlay';
  let acc = 0; // for throttling vertex updates

  const addToScene = (root: Object3D) => { (root as any).add(overlay.inst); };

  const setMode = (m: FireVizMode) => {
    mode = m;
    if (mode === 'overlay') {
      overlay.inst.visible = true;
      overlay.setOffsetY(0.05);
      overlay.setDepthTest(true);
      overlay.inst.renderOrder = 0;
    } else if (mode === 'raised') {
      overlay.inst.visible = true;
      overlay.setOffsetY(0.35);
      overlay.setDepthTest(false);
      overlay.inst.renderOrder = 3; // render after terrain
    } else {
      // vertex
      overlay.inst.visible = false;
    }
  };

  function applyVertexTint(grid: FireGrid) {
    // Update only visible chunks; modest cadence
    for (const m of chunkGroup.children as Mesh[]) {
      if (!m.visible) continue;
      const geo = m.geometry;
      const pos = geo.getAttribute('position');
      const col = geo.getAttribute('color');
      if (!col || !pos) continue;
      // base colors depend on which LOD is active
      const isHi = geo === (m as any).userData.geoHi;
      const base: Float32Array = isHi ? (m as any).userData.baseColorsHi : (m as any).userData.baseColorsLo;
      const arr = col.array as Float32Array;
      const posArr = pos.array as Float32Array;
      const scale = hm.scale;
      const gw = grid.width;
      const gh = grid.height;
      for (let vi = 0, i3 = 0; vi < pos.count; vi++, i3 += 3) {
        const wx = posArr[i3 + 0];
        const wz = posArr[i3 + 2];
        let gx = (wx / scale + 0.5) | 0;
        let gz = (wz / scale + 0.5) | 0;
        if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
        if (gz < 0) gz = 0; else if (gz >= gh) gz = gh - 1;
        const idx = gz * grid.width + gx;
        const t = grid.tiles[idx];
        // base color
        const r0 = base[vi * 3 + 0];
        const g0 = base[vi * 3 + 1];
        const b0 = base[vi * 3 + 2];
        let r = r0, g = g0, b = b0;
        // tint by state (more pronounced)
        if (t.state === 2 /* Burning */) {
          const heat = t.heat;
          const tr = 1.0;                     // vivid orange/yellow
          const tg = 0.35 + 0.55 * heat;      // 0.35..0.90
          const tb = 0.05 + 0.22 * heat;      // 0.05..0.27
          const a = 0.85 * (0.50 + 0.50 * heat); // stronger blend overall
          r = r0 * (1 - a) + tr * a;
          g = g0 * (1 - a) + tg * a;
          b = b0 * (1 - a) + tb * a;
        } else if (t.state === 3 /* Smoldering */) {
          const a = 0.70;                     // darker brown tint
          r = r0 * (1 - a) + 0.55 * a;
          g = g0 * (1 - a) + 0.24 * a;
          b = b0 * (1 - a) + 0.12 * a;
        } else if (t.state === 4 /* Burned */) {
          const a = 0.92;                     // near-char
          r = r0 * (1 - a) + 0.06 * a;
          g = g0 * (1 - a) + 0.06 * a;
          b = b0 * (1 - a) + 0.06 * a;
        }
        arr[vi * 3 + 0] = r;
        arr[vi * 3 + 1] = g;
        arr[vi * 3 + 2] = b;
      }
      col.needsUpdate = true;
    }
  }

  const update = (grid: FireGrid, dt: number) => {
    if (mode === 'overlay' || mode === 'raised') overlay.update(grid);
    else {
      acc += dt;
      if (acc >= 0.5) { // ~2 Hz, lighter on CPU
        applyVertexTint(grid);
        acc = 0;
      }
    }
  };

  return { overlay, setMode, update, addToScene, getMode: () => mode } as const;
}
