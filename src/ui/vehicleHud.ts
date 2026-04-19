/**
 * Vehicle HUD — displays fuel, water, and assignment status for the
 * currently-selected PathFollower unit.
 *
 * Intended to be mounted to the app container once and updated each frame
 * via `renderVehicleHud()`.
 */

export type VehicleHudEntry = {
  type: string;
  payload: {
    fuel: number;
    fuelCapacity: number;
    water: number;
    waterCapacity: number;
  };
  returningToBase: boolean;
  assignedIncidentId: number | null;
};

export type VehicleHud = {
  /** Update the HUD display. Pass null to hide it. */
  render(entry: VehicleHudEntry | null): void;
  /** Remove the HUD element from the DOM. */
  dispose(): void;
};

export function createVehicleHud(container: HTMLElement): VehicleHud {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    right: '12px',
    bottom: '12px',
    minWidth: '180px',
    padding: '8px 10px',
    color: '#e5e7eb',
    background: 'rgba(17,24,39,0.82)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    font: '12px system-ui, sans-serif',
    pointerEvents: 'none',
    display: 'none',
    lineHeight: '1.5',
  });
  container.appendChild(el);

  return {
    render(entry) {
      if (!entry) {
        el.style.display = 'none';
        return;
      }

      el.style.display = 'block';

      const fuelPct = entry.payload.fuelCapacity > 0
        ? Math.round((entry.payload.fuel / entry.payload.fuelCapacity) * 100)
        : 0;

      const waterPct = entry.payload.waterCapacity > 0
        ? Math.round((entry.payload.water / entry.payload.waterCapacity) * 100)
        : 0;

      const status =
        entry.returningToBase ? 'Returning to base' :
        entry.assignedIncidentId != null ? `Incident #${entry.assignedIncidentId}` :
        'Idle';

      el.innerHTML =
        `<div style="font-weight:600;margin-bottom:6px;">${entry.type}</div>` +
        `<div>Fuel:&nbsp; ${fuelPct}%</div>` +
        `<div>Water: ${waterPct}%</div>` +
        `<div>Status: ${status}</div>`;
    },

    dispose() {
      if (el.parentElement) el.parentElement.removeChild(el);
    },
  };
}
