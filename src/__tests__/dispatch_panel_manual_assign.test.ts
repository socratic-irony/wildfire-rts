/**
 * Regression: manual dispatch callback wiring — validates that manualDispatch
 * correctly updates the incident registry and that DispatchPanelCallbacks
 * interface supports getSelectedFollowerId + onManualDispatch.
 *
 * Tests the dispatch loop manualDispatch() and the incident reopen() contract
 * that back the "Assign selected" panel feature.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, FireState } from '../fire/grid';
import { createIncidentRegistry } from '../dispatch/incident';
import { createDispatchLoop } from '../systems/dispatchLoop';
import type { DispatchPanelCallbacks } from '../ui/dispatchPanel';

function flatGrid(size = 8) {
  const hm = generateHeightmap(size, size, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, { cellSize: 1 });
}

describe('dispatch_panel_manual_assign_selected', () => {
  it('manualDispatch marks incident assigned and returns true', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const [inc] = registry.detectFromFireGrid(grid, 0);
    expect(inc.status).toBe('detected');

    const loop = createDispatchLoop(registry, { autoDispatch: false });
    const ok = loop.manualDispatch(inc.id, 42, 1.0);

    expect(ok).toBe(true);
    const after = registry.byId(inc.id)!;
    expect(after.status).toBe('assigned');
    expect(after.assignedFollowerIds).toContain(42);
  });

  it('manualDispatch returns false for unknown incident id', () => {
    const registry = createIncidentRegistry(1);
    const loop = createDispatchLoop(registry, { autoDispatch: false });

    const ok = loop.manualDispatch(9999, 1, 0);
    expect(ok).toBe(false);
  });

  it('manualDispatch returns false for already resolved incident', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const [inc] = registry.detectFromFireGrid(grid, 0);
    registry.markResolved(inc.id, 1);

    const loop = createDispatchLoop(registry, { autoDispatch: false });
    const ok = loop.manualDispatch(inc.id, 42, 2);
    expect(ok).toBe(false);
    expect(registry.byId(inc.id)?.status).toBe('resolved');
  });

  it('DispatchPanelCallbacks type accepts getSelectedFollowerId and onManualDispatch', () => {
    // Type-level test: ensure the callback shape compiles correctly.
    const dispatchedCalls: { incidentId: number; followerId: number }[] = [];

    const callbacks: DispatchPanelCallbacks = {
      getSelectedFollowerId: () => 42,
      onManualDispatch: (incidentId, followerId) => {
        dispatchedCalls.push({ incidentId, followerId });
      },
    };

    // Simulate panel calling back
    const selectedId = callbacks.getSelectedFollowerId?.();
    expect(selectedId).toBe(42);

    callbacks.onManualDispatch?.(7, selectedId!);
    expect(dispatchedCalls).toHaveLength(1);
    expect(dispatchedCalls[0]).toEqual({ incidentId: 7, followerId: 42 });
  });

  it('getSelectedFollowerId can return null when no unit is selected', () => {
    const callbacks: DispatchPanelCallbacks = {
      getSelectedFollowerId: () => null,
    };
    expect(callbacks.getSelectedFollowerId?.()).toBeNull();
  });

  it('reopen() allows re-dispatch of a unit that left to refill', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;

    const registry = createIncidentRegistry(1);
    const [inc] = registry.detectFromFireGrid(grid, 0);

    registry.markAssigned(inc.id, [5], 1);
    registry.markEngaged(inc.id, 2);

    // Unit leaves → reopen so another unit can be dispatched
    registry.reopen(inc.id);
    expect(registry.byId(inc.id)?.status).toBe('detected');

    const loop = createDispatchLoop(registry, { autoDispatch: false });
    const ok = loop.manualDispatch(inc.id, 99, 3);
    expect(ok).toBe(true);
    expect(registry.byId(inc.id)?.assignedFollowerIds).toContain(99);
  });
});
