/**
 * Dispatch Panel — lightweight DOM overlay showing incident state and unit assignments.
 *
 * Intentionally minimal: a fixed panel that lists open incidents, their status,
 * and which units are assigned. Provides an auto-dispatch toggle and a manual-
 * dispatch trigger for the selected unit.
 *
 * Styling is inline so no external CSS dependency is needed.
 */

import type { DispatchLoop } from '../systems/dispatchLoop';
import type { Incident } from '../dispatch/incident';

const STATUS_COLORS: Record<string, string> = {
  detected: '#f59e0b',
  assigned: '#3b82f6',
  engaged: '#ef4444',
  resolved: '#22c55e',
};

export type DispatchPanelCallbacks = {
  /** Called when the user requests manual dispatch of `followerId` to `incidentId`. */
  onManualDispatch?: (incidentId: number, followerId: number) => void;
};

export class DispatchPanel {
  private container: HTMLDivElement;
  private incidentList: HTMLDivElement;
  private autoToggle: HTMLInputElement;
  private autoLabel: HTMLSpanElement;
  private statsLine: HTMLDivElement;
  private visible = true;

  constructor(
    parent: HTMLElement,
    private loop: DispatchLoop,
    private callbacks: DispatchPanelCallbacks = {}
  ) {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'absolute',
      top: '8px',
      right: '8px',
      width: '230px',
      background: 'rgba(15, 20, 30, 0.88)',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.08)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      color: '#e5e7eb',
      padding: '8px 10px',
      zIndex: '200',
      userSelect: 'none',
      boxSizing: 'border-box',
    });

    // Header row
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '6px',
      fontWeight: '600',
      fontSize: '12px',
      letterSpacing: '0.03em',
    });
    const title = document.createElement('span');
    title.textContent = '🚒 Dispatch';
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '−';
    Object.assign(toggleBtn.style, {
      background: 'none',
      border: 'none',
      color: '#9ca3af',
      cursor: 'pointer',
      fontSize: '14px',
      lineHeight: '1',
      padding: '0 2px',
    });
    toggleBtn.addEventListener('click', () => this.toggleCollapse());
    header.appendChild(title);
    header.appendChild(toggleBtn);
    this.container.appendChild(header);

    // Auto-dispatch toggle
    const autoRow = document.createElement('div');
    Object.assign(autoRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginBottom: '6px',
      padding: '3px 0',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
    });
    this.autoToggle = document.createElement('input');
    this.autoToggle.type = 'checkbox';
    this.autoToggle.checked = loop.getAutoDispatch();
    this.autoToggle.addEventListener('change', () => {
      loop.setAutoDispatch(this.autoToggle.checked);
    });
    this.autoLabel = document.createElement('span');
    this.autoLabel.textContent = 'Auto-dispatch';
    autoRow.appendChild(this.autoToggle);
    autoRow.appendChild(this.autoLabel);
    this.container.appendChild(autoRow);

    // Stats line
    this.statsLine = document.createElement('div');
    Object.assign(this.statsLine.style, {
      color: '#9ca3af',
      marginBottom: '5px',
      fontSize: '10px',
    });
    this.container.appendChild(this.statsLine);

    // Incident list
    this.incidentList = document.createElement('div');
    Object.assign(this.incidentList.style, {
      maxHeight: '220px',
      overflowY: 'auto',
    });
    this.container.appendChild(this.incidentList);

    parent.appendChild(this.container);
  }

  private toggleCollapse() {
    this.visible = !this.visible;
    this.incidentList.style.display = this.visible ? '' : 'none';
    this.statsLine.style.display = this.visible ? '' : 'none';
    if (this.autoToggle.parentElement) {
      this.autoToggle.parentElement.style.display = this.visible ? '' : 'none';
    }
  }

  /** Call each frame (or at reduced frequency) to refresh the panel. */
  update(unitCount: number, busyCount: number) {
    const all = this.loop.registry.list();
    const active = all.filter(i => i.status !== 'resolved');
    const resolved = all.filter(i => i.status === 'resolved').length;

    this.statsLine.textContent =
      `Units: ${unitCount - busyCount} idle / ${unitCount} total  •  Resolved: ${resolved}`;

    // Rebuild incident rows only when count changed (cheap: small lists)
    // We always rebuild for simplicity; panel is small.
    this.incidentList.innerHTML = '';

    if (active.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, { color: '#6b7280', fontStyle: 'italic', padding: '2px 0' });
      empty.textContent = 'No active incidents';
      this.incidentList.appendChild(empty);
      return;
    }

    for (const inc of active) {
      this.incidentList.appendChild(this.buildRow(inc));
    }
  }

  private buildRow(inc: Incident): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      flexDirection: 'column',
      padding: '4px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    });

    const top = document.createElement('div');
    Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

    const label = document.createElement('span');
    label.textContent = `#${inc.id} @ (${inc.tile.x},${inc.tile.z})`;

    const badge = document.createElement('span');
    badge.textContent = inc.status;
    Object.assign(badge.style, {
      background: STATUS_COLORS[inc.status] ?? '#6b7280',
      color: '#fff',
      borderRadius: '3px',
      padding: '1px 4px',
      fontSize: '10px',
      fontWeight: '600',
    });

    top.appendChild(label);
    top.appendChild(badge);
    row.appendChild(top);

    if (inc.assignedFollowerIds.length > 0) {
      const units = document.createElement('div');
      Object.assign(units.style, { color: '#9ca3af', marginTop: '1px', fontSize: '10px' });
      units.textContent = `Units: ${inc.assignedFollowerIds.map(id => `#${id}`).join(', ')}`;
      row.appendChild(units);
    }

    return row;
  }

  setVisible(on: boolean) {
    this.container.style.display = on ? '' : 'none';
  }

  dispose() {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
