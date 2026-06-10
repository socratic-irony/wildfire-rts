import type { Heightmap } from '../terrain/heightmap';
import { aStarPath, type CostField } from './astar';
import type { TerrainCost } from './cost';
import { makeAngularPath, type GridPoint } from './path';

type RoadPlannerWeights = {
  elevation: number;
  slope: number;
  valley: number;
  slopeMaxTan: number;
  curvature: number;
  grade: number;
};

const DEFAULT_WEIGHTS: RoadPlannerWeights = {
  elevation: 0.4,
  slope: 6.0,
  valley: 0.5,
  slopeMaxTan: 0.7,
  curvature: 2.8,
  grade: 14.0,
};

export function createRoadCostField(
  hm: Heightmap,
  roadCost: TerrainCost,
  weights: Partial<RoadPlannerWeights> = {},
): CostField {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  return {
    width: roadCost.width,
    height: roadCost.height,
    costAt: (x, z, stepDir, prevDir) => {
      const i = z * roadCost.width + x;
      const base = 1 + w.elevation * roadCost.elev[i] + w.slope * roadCost.slope[i] - w.valley * roadCost.valley[i];
      if (roadCost.slope[i] > w.slopeMaxTan) return Infinity;

      let grade = 0;
      const prevX = x - stepDir.dx;
      const prevZ = z - stepDir.dz;
      if (prevX >= 0 && prevZ >= 0 && prevX < roadCost.width && prevZ < roadCost.height) {
        const wxPrev = (prevX + 0.5) * hm.scale;
        const wzPrev = (prevZ + 0.5) * hm.scale;
        const wxCur = (x + 0.5) * hm.scale;
        const wzCur = (z + 0.5) * hm.scale;
        const hPrev = hm.sample(wxPrev, wzPrev);
        const hCur = hm.sample(wxCur, wzCur);
        const horiz = Math.hypot(stepDir.dx, stepDir.dz) * hm.scale;
        if (horiz > 1e-4) {
          const slope = Math.abs(hCur - hPrev) / horiz;
          grade = w.grade * Math.pow(slope, 1.35);
        }
      }

      let curv = 0;
      if (prevDir && (prevDir.dx !== 0 || prevDir.dz !== 0)) {
        const pvLen = Math.hypot(prevDir.dx, prevDir.dz) || 1;
        const stLen = Math.hypot(stepDir.dx, stepDir.dz) || 1;
        const pdx = prevDir.dx / pvLen;
        const pdz = prevDir.dz / pvLen;
        const sdx = stepDir.dx / stLen;
        const sdz = stepDir.dz / stLen;
        const dot = Math.max(-1, Math.min(1, pdx * sdx + pdz * sdz));
        curv = w.curvature * (1 - Math.max(0, dot));
      }

      return Math.max(0.05, base + grade + curv);
    },
  };
}

export function buildPlannedRoadPath(
  hm: Heightmap,
  roadCost: TerrainCost,
  start: GridPoint,
  goal: GridPoint,
  weights?: Partial<RoadPlannerWeights>,
): GridPoint[] {
  const field = createRoadCostField(hm, roadCost, weights);
  const rawPath = aStarPath(field, start, goal, {
    diag: false,
    heuristic: 'euclid',
    maxIter: roadCost.width * roadCost.height * 6,
  });
  return makeAngularPath(rawPath);
}
