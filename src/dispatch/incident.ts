import type { FireGrid } from '../fire/grid';
import { FireState } from '../fire/grid';

export type IncidentStatus = 'detected' | 'assigned' | 'engaged' | 'resolved';

export type Incident = {
  id: number;
  status: IncidentStatus;
  pos: { x: number; z: number };  // world coords
  tile: { x: number; z: number }; // grid coords
  detectedAt: number;             // simulation seconds
  assignedAt?: number;
  engagedAt?: number;
  resolvedAt?: number;
  assignedFollowerIds: number[];  // FollowerEntry ids
};

export type IncidentRegistry = {
  list(): ReadonlyArray<Incident>;
  byId(id: number): Incident | undefined;
  detectFromFireGrid(grid: FireGrid, simSeconds: number): Incident[];
  markAssigned(id: number, followerIds: number[], simSeconds: number): void;
  markEngaged(id: number, simSeconds: number): void;
  markResolved(id: number, simSeconds: number): void;
  /** Reopen a non-resolved incident (e.g. when its assigned unit leaves to refill). */
  reopen(id: number): void;
  prune(grid: FireGrid, simSeconds: number): number; // returns count pruned
};

const NEW_INCIDENT_MIN_SEPARATION_TILES = 6;

export function createIncidentRegistry(cellSize: number): IncidentRegistry {
  const incidents: Incident[] = [];
  let nextId = 1;

  const tilesTooClose = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz < NEW_INCIDENT_MIN_SEPARATION_TILES * NEW_INCIDENT_MIN_SEPARATION_TILES;
  };

  return {
    list: () => incidents,
    byId: (id) => incidents.find((i) => i.id === id),

    detectFromFireGrid(grid, simSeconds) {
      const created: Incident[] = [];
      for (let i = 0; i < grid.tiles.length; i++) {
        const tile = grid.tiles[i];
        if (tile.state !== FireState.Burning) continue;
        const tx = i % grid.width;
        const tz = Math.floor(i / grid.width);

        // Skip if any existing un-resolved incident is close
        let near = false;
        for (const inc of incidents) {
          if (inc.status === 'resolved') continue;
          if (tilesTooClose({ x: tx, z: tz }, inc.tile)) { near = true; break; }
        }
        if (near) continue;

        const incident: Incident = {
          id: nextId++,
          status: 'detected',
          tile: { x: tx, z: tz },
          pos: { x: (tx + 0.5) * cellSize, z: (tz + 0.5) * cellSize },
          detectedAt: simSeconds,
          assignedFollowerIds: [],
        };
        incidents.push(incident);
        created.push(incident);
      }
      return created;
    },

    markAssigned(id, followerIds, simSeconds) {
      const inc = incidents.find((i) => i.id === id);
      if (!inc) return;
      inc.status = 'assigned';
      inc.assignedFollowerIds = [...followerIds];
      inc.assignedAt = simSeconds;
    },

    markEngaged(id, simSeconds) {
      const inc = incidents.find((i) => i.id === id);
      if (!inc) return;
      inc.status = 'engaged';
      inc.engagedAt = simSeconds;
    },

    markResolved(id, simSeconds) {
      const inc = incidents.find((i) => i.id === id);
      if (!inc) return;
      inc.status = 'resolved';
      inc.resolvedAt = simSeconds;
    },

    reopen(id) {
      const inc = incidents.find((i) => i.id === id);
      if (!inc || inc.status === 'resolved') return;
      inc.status = 'detected';
      inc.assignedFollowerIds = [];
      delete inc.assignedAt;
      delete inc.engagedAt;
    },

    prune(grid, simSeconds) {
      let pruned = 0;
      for (const inc of incidents) {
        if (inc.status === 'resolved') continue;
        const idx = inc.tile.z * grid.width + inc.tile.x;
        const tile = grid.tiles[idx];
        // Auto-resolve if the tile is no longer hot
        if (tile.state !== FireState.Burning && tile.state !== FireState.Smoldering && tile.state !== FireState.Igniting) {
          inc.status = 'resolved';
          inc.resolvedAt = simSeconds;
          pruned++;
        }
      }
      return pruned;
    },
  };
}
