import { VehicleType } from '../vehicles/types';

export type Station = {
  id: number;
  name: string;
  pos: { x: number; z: number }; // world coords
  vehicleSlots: VehicleType[];   // what types live here
};

export type StationRegistry = {
  list(): ReadonlyArray<Station>;
  add(s: Omit<Station, 'id'>): Station;
  remove(id: number): boolean;
  nearest(pos: { x: number; z: number }): Station | undefined;
  clear(): void;
};

export function createStationRegistry(): StationRegistry {
  const stations: Station[] = [];
  let nextId = 1;
  return {
    list: () => stations,

    add(s) {
      const station: Station = { id: nextId++, ...s };
      stations.push(station);
      return station;
    },

    remove(id) {
      const idx = stations.findIndex((s) => s.id === id);
      if (idx < 0) return false;
      stations.splice(idx, 1);
      return true;
    },

    nearest(pos) {
      let best: Station | undefined;
      let bestD2 = Infinity;
      for (const s of stations) {
        const dx = s.pos.x - pos.x;
        const dz = s.pos.z - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = s; }
      }
      return best;
    },

    clear() { stations.length = 0; nextId = 1; },
  };
}
