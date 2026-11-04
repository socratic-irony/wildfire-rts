import { GRID_SIZE, TILE_SIZE, WORLD_SIZE } from '../world/constants';
import { World } from '../world/world';
import { Wildfire } from '../sim/fire';
import { Incident } from '../sim/incidents';
import { ScenarioResult } from '../sim/scenario';
import { NotifyTone, UnitSnapshot } from '../sim/types';
import { severityClass, severityLabel, sectorNameFor } from '../world/sectors';
import { TERRAIN_COLORS } from '../world/biomes';

export type Tool = 'select' | 'ignite' | 'road';

export interface HudState {
  scenario: ScenarioResult;
  fireActive: number;
  fireBurning: number;
  burnedHectares: number;
  incidents: Incident[];
  units: UnitSnapshot[];
  selectedUnit: UnitSnapshot | null;
  windDirection: number;
  windSpeed: number;
  autoDispatch: boolean;
  paused: boolean;
  speed: number;
  seed: number;
  tool: Tool;
  roadStart: boolean;
}

export interface HudCallbacks {
  onStart: () => void;
  onTool: (tool: Tool) => void;
  onSpeed: (speed: number) => void;
  onPause: () => void;
  onAutoDispatch: (enabled: boolean) => void;
  onIncidentFocus: (id: number) => void;
  onIncidentDispatch: (id: number) => void;
  onUnitSelect: (id: number) => void;
  onUnitAction: (id: number, action: 'home' | 'hold' | 'attack') => void;
  onMinimapFocus: (x: number, z: number) => void;
  onHelp: (open: boolean) => void;
  onRestart: () => void;
}

const ICONS = {
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1.1 3.3-1.5 4.9-1.5 7.2 0 1.2.8 2.1 1.9 2.1 1.3 0 2.1-1.1 2-2.5 2.1 1.7 3.6 4 3.6 6.7A6 6 0 0 1 6 15.5c0-3.4 2.5-5.1 3.4-7.7C10.3 5.3 10.7 3.4 12 2Z"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 9-6.1 1.2L9 20 5 3Z"/></svg>',
  road: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h3l-1 20H4L7 2Zm7 0h3l3 20h-5L14 2Zm-1 3h1v3h-1V5Zm0 6h1v3h-1v-3Zm0 6h1v3h-1v-3Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v5.4l3.7 2.2-1 1.7L11 13.5V7h2Z"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11.5a2.5 2.5 0 1 0-2.4-3.2l1.9.6A.5.5 0 1 1 14.5 6H3v2Zm0 4h16.5a2.5 2.5 0 1 1-2.4 3.2l1.9-.6A.5.5 0 1 0 19.5 14H3v-2Zm0 4h8.5a2.5 2.5 0 1 1-2.4 3.2l1.9-.6A.5.5 0 1 0 10.5 18H3v-2Z"/></svg>',
  structure: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8h-2v9h-5v-5h-4v5H5v-9H3Z"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.1 15.7a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm1.4-4.2h-2.1c0-1.5.5-2.2 1.5-2.9.8-.6 1.1-.9 1.1-1.6 0-.7-.5-1.2-1.3-1.2-.8 0-1.3.4-1.6 1.2l-1.9-.6c.5-1.5 1.7-2.4 3.6-2.4 2 0 3.3 1.1 3.3 2.8 0 1.4-.7 2.1-1.9 2.9-.7.5-.8.9-.7 1.8Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4v16H7V4Zm6 0h4v16h-4V4Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8V4Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 7 7-7 7 1.7 1.7L18.4 12 9.7 3.3 8 5Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 4.6 5.3 5.3L16.6 4.6 19.4 7.4 14.1 12.7l5.3 5.3-2.8 2.8-5.3-5.3-5.3 5.3-2.8-2.8 5.3-5.3L4.6 7.4 6 4.6Z"/></svg>',
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  private readonly world: World;
  private readonly fire: Wildfire;
  private readonly startScreen: HTMLElement;
  private readonly endScreen: HTMLElement;
  private readonly helpOverlay: HTMLElement;
  private readonly incidentList: HTMLElement;
  private readonly fleetList: HTMLElement;
  private readonly unitPanel: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly modeBanner: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly minimapContext: CanvasRenderingContext2D;
  private readonly baseMap: HTMLCanvasElement;
  private lastHtmlUpdate = 0;
  private endShown = false;
  private helpOpen = false;
  private unitPanelId: number | null = null;
  private readonly fleetRows = new Map<
    number,
    { root: HTMLButtonElement; badge: HTMLElement; name: HTMLElement; status: HTMLElement; water: HTMLElement }
  >();
  private readonly incidentCards = new Map<
    number,
    {
      root: HTMLElement;
      name: HTMLElement;
      subtitle: HTMLElement;
      assigned: HTMLElement;
      dispatch: HTMLButtonElement;
    }
  >();

  constructor(root: HTMLElement, world: World, fire: Wildfire, callbacks: HudCallbacks, seed: number) {
    this.root = root;
    this.world = world;
    this.fire = fire;
    this.callbacks = callbacks;
    this.baseMap = document.createElement('canvas');
    this.baseMap.width = GRID_SIZE;
    this.baseMap.height = GRID_SIZE;
    root.innerHTML = this.template(seed);
    root.classList.add('briefing');
    this.startScreen = this.getElement('#start-screen');
    this.endScreen = this.getElement('#end-screen');
    this.helpOverlay = this.getElement('#help-overlay');
    this.incidentList = this.getElement('#incident-list');
    this.fleetList = this.getElement('#fleet-list');
    this.unitPanel = this.getElement('#unit-panel');
    this.toolbar = this.getElement('#toolbar');
    this.topbar = this.getElement('#topbar');
    this.modeBanner = this.getElement('#mode-banner');
    this.toasts = this.getElement('#toasts');
    this.tooltip = this.getElement('#tooltip');
    this.minimap = this.getElement('#minimap') as HTMLCanvasElement;
    const context = this.minimap.getContext('2d');
    if (!context) throw new Error('Minimap canvas unavailable');
    this.minimapContext = context;
    this.renderMinimapBase();
    this.bindEvents();
  }

  showStart(): void {
    this.root.classList.add('briefing');
    this.startScreen.classList.add('visible');
  }

  hideStart(): void {
    this.root.classList.remove('briefing');
    this.startScreen.classList.remove('visible');
  }

  showEnd(result: ScenarioResult): void {
    if (this.endShown) return;
    this.endShown = true;
    const won = result.status === 'won';
    this.endScreen.innerHTML = `
      <div class="end-card ${won ? 'win' : 'loss'}">
        <div class="end-kicker">${won ? 'SHIFT COMPLETE' : 'SHIFT FAILED'}</div>
        <h1>${won ? 'The ridge holds.' : 'The fire won.'}</h1>
        <p class="end-reason">${result.reason}</p>
        <div class="end-stats">
          <div><span>STRUCTURES</span><strong>${result.structuresStanding} standing</strong><em>${result.structuresLost} lost</em></div>
          <div><span>BURNED</span><strong>${result.burnedHectares.toFixed(1)} ha</strong><em>${result.incidentsContained} incidents contained</em></div>
          <div><span>TIME</span><strong>${formatTime(result.elapsed)}</strong><em>${formatTime(result.remaining)} left</em></div>
          <div><span>SCORE</span><strong>${result.score.toLocaleString()}</strong><em>final tally</em></div>
        </div>
        <button type="button" class="primary-button" data-action="restart">Start New Shift</button>
      </div>
    `;
    this.endScreen.classList.add('visible');
  }

  toast(message: string, tone: NotifyTone = 'info'): void {
    const item = document.createElement('div');
    item.className = `toast ${tone}`;
    item.textContent = message;
    this.toasts.prepend(item);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild?.remove();
    window.setTimeout(() => {
      item.classList.add('leaving');
      window.setTimeout(() => item.remove(), 380);
    }, 4600);
  }

  setTool(tool: Tool): void {
    for (const button of this.toolbar.querySelectorAll<HTMLElement>('[data-tool]')) {
      button.classList.toggle('active', button.dataset.tool === tool);
    }
  }

  setHelp(open: boolean): void {
    this.helpOpen = open;
    this.helpOverlay.classList.toggle('visible', open);
    this.callbacks.onHelp(open);
  }

  get isHelpOpen(): boolean {
    return this.helpOpen;
  }

  setTooltip(text: string | null, x = 0, y = 0): void {
    if (!text) {
      this.tooltip.classList.remove('visible');
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.transform = `translate(${Math.min(x + 18, window.innerWidth - 320)}px, ${Math.min(y + 18, window.innerHeight - 80)}px)`;
    this.tooltip.classList.add('visible');
  }

  update(state: HudState, force = false): void {
    this.drawMinimap(state);
    const now = performance.now();
    if (!force && now - this.lastHtmlUpdate < 160) return;
    this.lastHtmlUpdate = now;
    this.topbar.querySelector('[data-metric="time"]')!.textContent = formatTime(state.scenario.remaining);
    this.topbar.querySelector('[data-metric="fires"]')!.textContent = String(state.fireActive);
    this.topbar.querySelector('[data-metric="structures"]')!.textContent = `${state.scenario.structuresStanding}`;
    this.topbar.querySelector('[data-metric="burned"]')!.textContent = `${state.burnedHectares.toFixed(1)} ha`;
    this.topbar.querySelector('[data-metric="wind"]')!.textContent = `${state.windSpeed.toFixed(1)} m/s ${compassLabel(state.windDirection)}`;
    const windLabel = this.root.querySelector('[data-wind-label]');
    if (windLabel) windLabel.textContent = `${state.windSpeed.toFixed(1)} m/s`;
    const windCompass = this.root.querySelector('[data-wind-compass]');
    if (windCompass) windCompass.textContent = compassLabel(state.windDirection);
    const windArrow = this.root.querySelector<HTMLElement>('.wind-arrow');
    if (windArrow) windArrow.style.transform = `rotate(${state.windDirection}rad)`;
    this.topbar.querySelector('.objective-copy')!.textContent = state.scenario.reason;
    this.topbar.querySelector('.shift-fill')!.setAttribute('style', `width:${(1 - state.scenario.remaining / (8 * 60)) * 100}%`);
    this.updateTimeControls(state);
    this.renderIncidents(state);
    this.renderFleet(state);
    this.renderUnitPanel(state);
    this.renderModeBanner(state);
    const auto = this.root.querySelector<HTMLInputElement>('#auto-dispatch');
    if (auto) auto.checked = state.autoDispatch;
    if (state.scenario.status === 'won' || state.scenario.status === 'lost') {
      this.showEnd(state.scenario);
    }
  }

  refreshMinimapBase(): void {
    this.renderMinimapBase();
  }

  private template(seed: number): string {
    return `
      <div class="vignette"></div>
      <header class="topbar" id="topbar">
        <div class="brand">
          <span class="brand-mark">${ICONS.flame}</span>
          <span class="brand-name">CINDERLINE</span>
          <span class="brand-sub">WILDFIRE COMMAND</span>
        </div>
        <div class="objective">
          <div class="objective-label">CURRENT DIRECTIVE</div>
          <div class="objective-copy">Protect the town and contain every wildfire before the shift ends.</div>
          <div class="shift-track"><span class="shift-fill"></span></div>
        </div>
        <div class="metrics">
          <div class="metric"><span>${ICONS.clock} SHIFT</span><strong data-metric="time">08:00</strong></div>
          <div class="metric"><span>${ICONS.flame} FIRES</span><strong data-metric="fires">0</strong></div>
          <div class="metric"><span>${ICONS.structure} STRUCTURES</span><strong data-metric="structures">0</strong></div>
          <div class="metric secondary"><span>BURNED</span><strong data-metric="burned">0.0 ha</strong></div>
          <div class="metric secondary"><span>${ICONS.wind} WIND</span><strong data-metric="wind">0.0 m/s</strong></div>
        </div>
        <div class="time-controls">
          <button type="button" class="icon-button" data-action="pause" aria-label="Pause">${ICONS.pause}</button>
          <div class="speed-group">
            <button type="button" data-speed="1" class="speed-button active">1x</button>
            <button type="button" data-speed="2" class="speed-button">2x</button>
            <button type="button" data-speed="4" class="speed-button">4x</button>
          </div>
          <button type="button" class="icon-button" data-action="help" aria-label="Help">${ICONS.help}</button>
        </div>
      </header>

      <div class="mode-banner" id="mode-banner"></div>
      <div class="toasts" id="toasts"></div>

      <aside class="left-column">
        <section class="panel incident-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">INCIDENT BOARD</span>
              <h2>Active fires</h2>
            </div>
            <label class="switch" title="Automatically dispatch available units">
              <input type="checkbox" id="auto-dispatch" checked />
              <span class="switch-track"><span class="switch-thumb"></span></span>
              <span class="switch-label">AUTO</span>
            </label>
          </div>
          <div class="incident-list" id="incident-list"></div>
        </section>
        <section class="panel fleet-panel">
          <div class="panel-heading compact">
            <div>
              <span class="panel-kicker">RESPONSE FLEET</span>
              <h2>Units</h2>
            </div>
            <span class="panel-note">click to select</span>
          </div>
          <div class="fleet-list" id="fleet-list"></div>
        </section>
      </aside>

      <section class="unit-panel panel" id="unit-panel"></section>

      <nav class="toolbar" id="toolbar" aria-label="Map tools">
        <button type="button" class="tool-button active" data-tool="select" aria-label="Select tool">
          <span class="tool-icon">${ICONS.cursor}</span><span class="tool-name">Select</span><kbd>V</kbd>
        </button>
        <button type="button" class="tool-button" data-tool="ignite" aria-label="Ignite tool">
          <span class="tool-icon">${ICONS.flame}</span><span class="tool-name">Ignite</span><kbd>I</kbd>
        </button>
        <button type="button" class="tool-button" data-tool="road" aria-label="Road tool">
          <span class="tool-icon">${ICONS.road}</span><span class="tool-name">Road</span><kbd>B</kbd>
        </button>
        <span class="toolbar-divider"></span>
        <button type="button" class="tool-button subtle" data-action="help" aria-label="Help and controls">
          <span class="tool-icon">${ICONS.help}</span><span class="tool-name">Help</span><kbd>H</kbd>
        </button>
      </nav>

      <aside class="minimap-panel panel">
        <div class="panel-heading compact">
          <div>
            <span class="panel-kicker">SECTOR MAP</span>
            <h2>Raven Ridge</h2>
          </div>
          <span class="seed-label">SEED ${seed}</span>
        </div>
        <canvas id="minimap" width="220" height="220" aria-label="Map overview"></canvas>
        <div class="minimap-wind"><span class="wind-arrow"></span><strong data-wind-label>5.4 m/s</strong><em data-wind-compass>NW</em></div>
        <div class="minimap-legend">
          <span><i class="legend-dot engine"></i>Engine</span>
          <span><i class="legend-dot air"></i>Air</span>
          <span><i class="legend-dot fire"></i>Fire</span>
        </div>
      </aside>

      <div class="tooltip" id="tooltip"></div>

      <div class="help-overlay" id="help-overlay">
        <div class="help-card">
          <button type="button" class="close-button" data-action="close-help" aria-label="Close">${ICONS.close}</button>
          <span class="panel-kicker">FIELD MANUAL</span>
          <h2>Command basics</h2>
          <div class="help-grid">
            <div><kbd>Left click</kbd><span>Select a unit, place a tool action, or order an attack on a fire.</span></div>
            <div><kbd>Right click</kbd><span>Move the selected unit or aircraft. On a fire, the unit attacks it.</span></div>
            <div><kbd>W A S D</kbd><span>Pan the camera. Arrow keys work too.</span></div>
            <div><kbd>Q / E</kbd><span>Rotate the camera. <kbd>R / F</kbd> tilts.</span></div>
            <div><kbd>Wheel</kbd><span>Zoom toward the cursor.</span></div>
            <div><kbd>Middle drag</kbd><span>Grab and pan the map.</span></div>
            <div><kbd>V / I / B</kbd><span>Select, ignite, and road tools.</span></div>
            <div><kbd>Space</kbd><span>Pause or resume the shift.</span></div>
            <div><kbd>1 / 2 / 4</kbd><span>Set simulation speed.</span></div>
            <div><kbd>Esc</kbd><span>Cancel the current road start or close this manual.</span></div>
          </div>
          <p class="help-note">Engines need road access and water. Aircraft drop from above. Dozers cut permanent firelines. Hydrants refill ground units and give an engine an unlimited feed while it is parked beside one.</p>
        </div>
      </div>

      <div class="start-screen visible" id="start-screen">
        <div class="start-backdrop"></div>
        <div class="start-card">
          <div class="start-flag">RAVEN RIDGE / AUGUST 17 / 16:40</div>
          <h1>CINDERLINE</h1>
          <p class="start-tagline">A wildfire command RTS. Read the wind. Hold the line.</p>
          <p class="start-copy">Four lightning strikes are forecast across the ridge. Protect the town, keep the road open, and contain every fire before the eight-minute shift runs out.</p>
          <div class="start-features">
            <div><strong>+</strong><span>Road engines, dozers, helicopters, and air tankers</span></div>
            <div><strong>+</strong><span>Wind-driven fire, embers, retardant, and firelines</span></div>
            <div><strong>+</strong><span>Hydrants, auto-dispatch, and manual command</span></div>
          </div>
          <div class="start-actions">
            <button type="button" class="primary-button" data-action="start">Start Shift</button>
            <span class="start-hint">WASD pan · Q/E rotate · wheel zoom</span>
          </div>
        </div>
      </div>

      <div class="end-screen" id="end-screen"></div>
    `;
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const actionElement = target.closest<HTMLElement>('[data-action]');
      if (actionElement) {
        const action = actionElement.dataset.action;
        if (action === 'start') {
          this.callbacks.onStart();
          this.hideStart();
        } else if (action === 'restart') {
          this.callbacks.onRestart();
        } else if (action === 'pause') {
          this.callbacks.onPause();
        } else if (action === 'help') {
          this.setHelp(true);
        } else if (action === 'close-help') {
          this.setHelp(false);
        }
        return;
      }
      const speedButton = target.closest<HTMLElement>('[data-speed]');
      if (speedButton) {
        const speed = Number(speedButton.dataset.speed);
        if (speed > 0) this.callbacks.onSpeed(speed);
        return;
      }
      const toolButton = target.closest<HTMLElement>('[data-tool]');
      if (toolButton) {
        const tool = toolButton.dataset.tool as Tool;
        if (tool === 'select' || tool === 'ignite' || tool === 'road') this.callbacks.onTool(tool);
        return;
      }
      const dispatchButton = target.closest<HTMLElement>('[data-dispatch]');
      if (dispatchButton) {
        const id = Number(dispatchButton.dataset.dispatch);
        if (id > 0) this.callbacks.onIncidentDispatch(id);
        return;
      }
      const focusButton = target.closest<HTMLElement>('[data-focus-incident]');
      if (focusButton) {
        const id = Number(focusButton.dataset.focusIncident);
        if (id > 0) this.callbacks.onIncidentFocus(id);
        return;
      }
      const unitButton = target.closest<HTMLElement>('[data-unit]');
      if (unitButton) {
        const id = Number(unitButton.dataset.unit);
        if (id > 0) this.callbacks.onUnitSelect(id);
        return;
      }
      const unitAction = target.closest<HTMLElement>('[data-unit-action]');
      if (unitAction) {
        const id = Number(unitAction.dataset.unitId);
        const action = unitAction.dataset.unitAction;
        if (id > 0 && (action === 'home' || action === 'hold' || action === 'attack')) {
          this.callbacks.onUnitAction(id, action);
        }
      }
    });

    this.root.querySelector<HTMLInputElement>('#auto-dispatch')?.addEventListener('change', (event) => {
      this.callbacks.onAutoDispatch((event.target as HTMLInputElement).checked);
    });

    this.minimap.addEventListener('click', (event) => {
      const rect = this.minimap.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * WORLD_SIZE;
      const z = ((event.clientY - rect.top) / rect.height) * WORLD_SIZE;
      this.callbacks.onMinimapFocus(x, z);
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.helpOpen) {
        this.setHelp(false);
        event.preventDefault();
      }
    });
  }

  private updateTimeControls(state: HudState): void {
    const pause = this.topbar.querySelector<HTMLElement>('[data-action="pause"]');
    if (pause) pause.innerHTML = state.paused ? ICONS.play : ICONS.pause;
    for (const button of this.topbar.querySelectorAll<HTMLElement>('[data-speed]')) {
      button.classList.toggle('active', Number(button.dataset.speed) === state.speed && !state.paused);
    }
    this.topbar.classList.toggle('is-paused', state.paused);
  }

  private renderIncidents(state: HudState): void {
    const active = state.incidents.filter((incident) => !incident.resolved);
    for (const [id, refs] of this.incidentCards) {
      if (active.some((incident) => incident.id === id)) continue;
      refs.root.remove();
      this.incidentCards.delete(id);
    }
    if (active.length === 0) {
      if (!this.incidentList.querySelector('.empty-state')) {
        this.incidentList.innerHTML = `<div class="empty-state"><span>All quiet.</span><em>No active incidents on the board.</em></div>`;
      }
      return;
    }
    this.incidentList.querySelector('.empty-state')?.remove();
    for (const incident of active) {
      let refs = this.incidentCards.get(incident.id);
      if (!refs) {
        const root = document.createElement('article');
        root.className = 'incident-card';
        root.dataset.focusIncident = String(incident.id);
        root.innerHTML = `
          <div class="severity-rail"><span></span></div>
          <div class="incident-body">
            <div class="incident-top">
              <div>
                <strong></strong>
                <span></span>
              </div>
              <button type="button" class="mini-button">DISPATCH</button>
            </div>
            <div class="incident-assigned"></div>
          </div>
        `;
        const name = root.querySelector('strong') as HTMLElement;
        const subtitle = root.querySelector('.incident-top span') as HTMLElement;
        const assigned = root.querySelector('.incident-assigned') as HTMLElement;
        const dispatch = root.querySelector('.mini-button') as HTMLButtonElement;
        dispatch.dataset.dispatch = String(incident.id);
        this.incidentList.appendChild(root);
        refs = { root, name, subtitle, assigned, dispatch };
        this.incidentCards.set(incident.id, refs);
      }
      refs.root.className = `incident-card ${severityClass(incident.severity)}`;
      refs.name.textContent = sectorNameFor(incident.tx, incident.tz);
      refs.subtitle.textContent = `${severityLabel(incident.severity)} · ${incident.severity} active cells`;
      const assignedNames = state.units
        .filter((unit) => unit.incidentId === incident.id)
        .map((unit) => unit.name);
      refs.assigned.innerHTML = assignedNames.length
        ? assignedNames.map((name) => `<span class="assigned-chip">${name}</span>`).join('')
        : '<span class="assigned-chip ghost">Unassigned</span>';
    }
  }

  private renderFleet(state: HudState): void {
    for (const unit of state.units) {
      let refs = this.fleetRows.get(unit.id);
      if (!refs) {
        const root = document.createElement('button');
        root.type = 'button';
        root.className = 'fleet-row';
        root.dataset.unit = String(unit.id);
        root.innerHTML = `
          <span class="unit-badge"></span>
          <span class="fleet-copy"><strong></strong><em></em></span>
          <span class="fleet-water"></span>
        `;
        const badge = root.querySelector('.unit-badge') as HTMLElement;
        const name = root.querySelector('strong') as HTMLElement;
        const status = root.querySelector('em') as HTMLElement;
        const water = root.querySelector('.fleet-water') as HTMLElement;
        this.fleetList.appendChild(root);
        refs = { root, badge, name, status, water };
        this.fleetRows.set(unit.id, refs);
      }
      const ratio = unit.capacity > 0 ? unit.water / unit.capacity : 0;
      const kindClass = unit.kind === 'helicopter' || unit.kind === 'tanker' ? 'air' : unit.kind === 'dozer' ? 'dozer' : 'engine';
      refs.root.classList.toggle('selected', unit.selected);
      refs.badge.className = `unit-badge ${kindClass}`;
      refs.name.textContent = unit.name;
      refs.status.textContent = unit.status;
      refs.water.textContent = unit.capacity > 0 ? `${Math.round(ratio * 100)}%` : '—';
    }
  }

  private renderUnitPanel(state: HudState): void {
    const unit = state.selectedUnit;
    if (!unit) {
      this.unitPanel.classList.remove('visible');
      if (this.unitPanelId !== null) this.unitPanel.innerHTML = '';
      this.unitPanelId = null;
      return;
    }
    if (this.unitPanelId !== unit.id) {
      const isAir = unit.kind === 'helicopter' || unit.kind === 'tanker';
      const payloadLabel = isAir ? 'PAYLOAD' : 'WATER';
      this.unitPanel.innerHTML = `
        <div class="unit-head">
          <div>
            <span class="panel-kicker">SELECTED UNIT</span>
            <h2>${unit.name}</h2>
          </div>
          <span class="unit-state"></span>
        </div>
        <div class="unit-bars">
          <div class="bar-label"><span>${payloadLabel}</span><strong></strong></div>
          <div class="meter"><span></span></div>
          <div class="unit-flags"></div>
        </div>
        <div class="unit-actions">
          <button type="button" class="secondary-button" data-unit-action="attack" data-unit-id="${unit.id}">Attack nearest</button>
          <button type="button" class="secondary-button" data-unit-action="home" data-unit-id="${unit.id}">Return to base</button>
          <button type="button" class="secondary-button" data-unit-action="hold" data-unit-id="${unit.id}">Hold</button>
        </div>
      `;
      this.unitPanelId = unit.id;
    }
    const ratio = unit.capacity > 0 ? Math.max(0, Math.min(1, unit.water / unit.capacity)) : 0;
    this.unitPanel.classList.add('visible');
    const stateLabel = this.unitPanel.querySelector('.unit-state');
    const waterLabel = this.unitPanel.querySelector('.bar-label strong');
    const meter = this.unitPanel.querySelector('.meter span') as HTMLElement | null;
    const flags = this.unitPanel.querySelector('.unit-flags');
    if (stateLabel) stateLabel.textContent = unit.status;
    if (waterLabel) waterLabel.textContent = `${Math.round(unit.water)} / ${unit.capacity || 0} L`;
    if (meter) meter.style.width = `${ratio * 100}%`;
    if (flags) {
      flags.innerHTML = `${unit.hydrantConnected ? '<span class="flag hydrant">HYDRANT FEED</span>' : ''}${
        unit.incidentId !== null ? `<span class="flag assigned">INCIDENT #${unit.incidentId}</span>` : ''
      }`;
    }
  }

  private renderModeBanner(state: HudState): void {
    if (state.tool === 'select') {
      this.modeBanner.classList.remove('visible');
      return;
    }
    this.modeBanner.classList.add('visible');
    if (state.tool === 'ignite') {
      this.modeBanner.innerHTML = `<strong>IGNITE TOOL</strong><span>Click timber, brush, or grass to start a test fire.</span>`;
    } else if (state.roadStart) {
      this.modeBanner.innerHTML = `<strong>ROAD TOOL</strong><span>Click the destination tile. Esc cancels.</span>`;
    } else {
      this.modeBanner.innerHTML = `<strong>ROAD TOOL</strong><span>Click a start tile to plan a new road.</span>`;
    }
  }

  private renderMinimapBase(): void {
    const ctx = this.baseMap.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tz * GRID_SIZE + tx;
        const type = this.world.biomes.types[index] ?? 4;
        let color = TERRAIN_COLORS[type as keyof typeof TERRAIN_COLORS] ?? 0x7fac5d;
        const slope = this.world.heightmap.slopeTan(tx, tz);
        const height = this.world.heightmap.tileHeight(tx, tz);
        const base = color;
        const r = ((base >> 16) & 0xff) * (0.82 + height * 0.006) * (1 - slope * 0.18);
        const g = ((base >> 8) & 0xff) * (0.82 + height * 0.006) * (1 - slope * 0.18);
        const b = (base & 0xff) * (0.82 + height * 0.006) * (1 - slope * 0.18);
        color = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(tx, tz, 1, 1);
      }
    }
    this.world.roads.forEach((tx, tz) => {
      ctx.fillStyle = '#3f3f3d';
      ctx.fillRect(tx, tz, 1, 1);
    });
    for (const building of this.world.buildings.buildings) {
      ctx.fillStyle = building.state === 'destroyed' ? '#3b2b24' : '#e2c58d';
      ctx.fillRect(building.x0 + 0.3, building.z0 + 0.3, Math.max(1, building.worldW - 0.6), Math.max(1, building.worldD - 0.6));
    }
  }

  private drawMinimap(state: HudState): void {
    const ctx = this.minimapContext;
    const w = this.minimap.width;
    const h = this.minimap.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.baseMap, 0, 0, w, h);
    const scale = w / GRID_SIZE;
    for (let i = 0; i < this.fire.state.length; i += 1) {
      const fireState = this.fire.state[i];
      if (fireState === 0) continue;
      const tx = i % GRID_SIZE;
      const tz = Math.floor(i / GRID_SIZE);
      if (fireState === 1 || fireState === 2) {
        ctx.fillStyle = '#ff7a2d';
      } else if (fireState === 3) {
        ctx.fillStyle = '#7a3a2a';
      } else if (fireState === 4) {
        ctx.fillStyle = '#2b2520';
      } else {
        ctx.fillStyle = '#d8c79a';
      }
      ctx.fillRect(tx * scale, tz * scale, scale, scale);
    }
    for (const incident of state.incidents) {
      if (incident.resolved) continue;
      ctx.strokeStyle = '#ffd37a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((incident.tx + 0.5) * scale, (incident.tz + 0.5) * scale, 4 + Math.sin(performance.now() / 240 + incident.id) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const unit of state.units) {
      ctx.fillStyle = unit.kind === 'helicopter' || unit.kind === 'tanker' ? '#7ed7ea' : unit.kind === 'dozer' ? '#e9c04c' : '#ef6a5b';
      const x = (unit.x / TILE_SIZE) * scale;
      const y = (unit.z / TILE_SIZE) * scale;
      ctx.beginPath();
      ctx.arc(x, y, unit.selected ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (unit.selected) {
        ctx.strokeStyle = '#fff6da';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255, 244, 210, 0.55)';
    ctx.lineWidth = 1;
    const viewWidth = (this.lastCameraView?.width ?? 66) / WORLD_SIZE * w;
    const viewHeight = (this.lastCameraView?.height ?? 66) / WORLD_SIZE * h;
    const cx = (this.lastCameraView?.x ?? WORLD_SIZE / 2) / WORLD_SIZE * w;
    const cy = (this.lastCameraView?.z ?? WORLD_SIZE / 2) / WORLD_SIZE * h;
    ctx.strokeRect(cx - viewWidth / 2, cy - viewHeight / 2, viewWidth, viewHeight);
  }

  lastCameraView: { x: number; z: number; width: number; height: number } | null = null;

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element ${selector}`);
    return element;
  }
}

function compassLabel(angle: number): string {
  const normal = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const index = Math.round(normal / (Math.PI / 4)) % 8;
  return ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'][index] ?? 'S';
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}
