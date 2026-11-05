import { GRID_SIZE, TILE_SIZE, WORLD_SIZE } from '../world/constants';
import { World } from '../world/world';
import { Wildfire } from '../sim/fire';
import { Incident } from '../sim/incidents';
import { compass, ScenarioResult, SHIFT_SECONDS, WindShift } from '../sim/scenario';
import { NotifyTone, UnitSnapshot } from '../sim/types';
import { UnitKind } from '../sim/vehicleModels';
import { MUTUAL_AID_COST, ROAD_COST_PER_TILE, TORCH_COST } from '../sim/budget';
import { DIFFICULTIES, DIFFICULTY_ORDER, DifficultyId } from '../sim/difficulty';
import { severityClass, severityLabel } from '../world/sectors';
import { TERRAIN_COLORS } from '../world/biomes';

export type Tool = 'select' | 'torch' | 'road' | 'line';
export type UnitAction = 'home' | 'hold' | 'attack' | 'line';

export interface ThreatSummary {
  /** Intact structures with active wildfire close by. */
  total: number;
  /** Threatened structures attributed to each incident id. */
  byIncident: Map<number, number>;
  /** Ids of threatened buildings. */
  buildings: Set<number>;
}

export interface BestRecord {
  score: number;
  grade: string;
}

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
  lineStart: boolean;
  preview: { tiles: number; cost: number } | null;
  funds: number;
  income: number;
  difficulty: DifficultyId;
  reinforcements: Array<{ name: string; eta: number }>;
  mutualAidLeft: number;
  nextWind: WindShift | null;
  nextStrikeIn: number | null;
  shiftTime: number;
  threats: ThreatSummary;
  savedStructures: number;
  muted: boolean;
  best: BestRecord | null;
  newBest: boolean;
}

export interface HudCallbacks {
  onStart: () => void;
  onDifficulty: (id: DifficultyId) => void;
  onTool: (tool: Tool) => void;
  onSpeed: (speed: number) => void;
  onPause: () => void;
  onMute: () => void;
  onAutoDispatch: (enabled: boolean) => void;
  onIncidentFocus: (id: number) => void;
  onIncidentDispatch: (id: number) => void;
  onUnitSelect: (id: number) => void;
  onUnitAction: (id: number, action: UnitAction) => void;
  onMutualAid: (kind: UnitKind) => void;
  onMinimapFocus: (x: number, z: number) => void;
  onHelp: (open: boolean) => void;
  onRestart: (sameSeed: boolean) => void;
}

const ICONS = {
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1.1 3.3-1.5 4.9-1.5 7.2 0 1.2.8 2.1 1.9 2.1 1.3 0 2.1-1.1 2-2.5 2.1 1.7 3.6 4 3.6 6.7A6 6 0 0 1 6 15.5c0-3.4 2.5-5.1 3.4-7.7C10.3 5.3 10.7 3.4 12 2Z"/></svg>',
  torch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 2.2c.5 2-1 3-1 4.4 0 .8.6 1.3 1.3 1.3.9 0 1.4-.7 1.3-1.6 1.4 1.1 2.3 2.6 2.3 4.3a4 4 0 0 1-3.2 3.9L8.4 21.4 6.6 19.6l6-6A4 4 0 0 1 10 9.9c0-2.2 1.6-3.3 2.2-5 .4-1.1.7-2 1.4-2.7Z"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 9-6.1 1.2L9 20 5 3Z"/></svg>',
  road: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h3l-1 20H4L7 2Zm7 0h3l3 20h-5L14 2Zm-1 3h1v3h-1V5Zm0 6h1v3h-1v-3Zm0 6h1v3h-1v-3Z"/></svg>',
  dozer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h7l2 4h4v5h-1.2a2.5 2.5 0 0 0-4.6 0H9.8a2.5 2.5 0 0 0-4.6 0H4V7Zm2 2v2h5.4l-1-2H6Zm-4.5 5H3v4.5H1.5V14ZM7.5 15.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6.8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM18 12h2.5l1.5 6.5h-4V12Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v5.4l3.7 2.2-1 1.7L11 13.5V7h2Z"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11.5a2.5 2.5 0 1 0-2.4-3.2l1.9.6A.5.5 0 1 1 14.5 6H3v2Zm0 4h16.5a2.5 2.5 0 1 1-2.4 3.2l1.9-.6A.5.5 0 1 0 19.5 14H3v-2Zm0 4h8.5a2.5 2.5 0 1 1-2.4 3.2l1.9-.6A.5.5 0 1 0 10.5 18H3v-2Z"/></svg>',
  structure: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8h-2v9h-5v-5h-4v5H5v-9H3Z"/></svg>',
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 4v1.1c1.5.3 2.6 1.2 2.9 2.6l-1.9.5c-.2-.8-.9-1.3-2-1.3-1.2 0-1.8.5-1.8 1.1 0 .7.6 1 2.1 1.3 2.1.4 3.6 1.1 3.6 3.1 0 1.5-1.1 2.6-2.9 2.9V18h-2v-1.1c-1.7-.3-2.9-1.3-3.2-2.9l2-.5c.2 1 1 1.6 2.3 1.6 1.2 0 1.9-.5 1.9-1.2 0-.7-.6-1-2.2-1.3-2-.4-3.5-1.1-3.5-3 0-1.4 1-2.5 2.7-2.8V6h2Z"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.1 15.7a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm1.4-4.2h-2.1c0-1.5.5-2.2 1.5-2.9.8-.6 1.1-.9 1.1-1.6 0-.7-.5-1.2-1.3-1.2-.8 0-1.3.4-1.6 1.2l-1.9-.6c.5-1.5 1.7-2.4 3.6-2.4 2 0 3.3 1.1 3.3 2.8 0 1.4-.7 2.1-1.9 2.9-.7.5-.8.9-.7 1.8Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4v16H7V4Zm6 0h4v16h-4V4Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8V4Z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4V9Zm12.2-1.6a6 6 0 0 1 0 9.2l-1.4-1.4a4 4 0 0 0 0-6.4l1.4-1.4Zm2.8-2.8a10 10 0 0 1 0 14.8l-1.4-1.4a8 8 0 0 0 0-12l1.4-1.4Z"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4V9Zm12.3.3 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 4.6 5.3 5.3L16.6 4.6 19.4 7.4 14.1 12.7l5.3 5.3-2.8 2.8-5.3-5.3-5.3 5.3-2.8-2.8 5.3-5.3L4.6 7.4 6 4.6Z"/></svg>',
};

const AID_OPTIONS: Array<{ kind: UnitKind; label: string }> = [
  { kind: 'firetruck', label: 'Engine' },
  { kind: 'dozer', label: 'Dozer' },
  { kind: 'helicopter', label: 'Heli' },
];

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
  private readonly aidPanel: HTMLElement;
  private readonly unitPanel: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly modeBanner: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly minimapContext: CanvasRenderingContext2D;
  private readonly baseMap: HTMLCanvasElement;
  private lastHtmlUpdate = 0;
  private endShown = false;
  private helpOpen = false;
  private unitPanelId: number | null = null;
  private unitPanelKind = '';
  private lastFunds = 0;
  private threatened = new Set<number>();
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
      threat: HTMLElement;
      assigned: HTMLElement;
      dispatch: HTMLButtonElement;
    }
  >();

  constructor(
    root: HTMLElement,
    world: World,
    fire: Wildfire,
    callbacks: HudCallbacks,
    seed: number,
    difficulty: DifficultyId,
  ) {
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
    this.aidPanel = this.getElement('#aid-panel');
    this.unitPanel = this.getElement('#unit-panel');
    this.toolbar = this.getElement('#toolbar');
    this.topbar = this.getElement('#topbar');
    this.modeBanner = this.getElement('#mode-banner');
    this.toasts = this.getElement('#toasts');
    this.tooltip = this.getElement('#tooltip');
    this.flash = this.getElement('#lightning-flash');
    this.minimap = this.getElement('#minimap') as HTMLCanvasElement;
    const context = this.minimap.getContext('2d');
    if (!context) throw new Error('Minimap canvas unavailable');
    this.minimapContext = context;
    this.renderMinimapBase();
    this.bindEvents();
    this.setDifficulty(difficulty);
  }

  showStart(): void {
    this.root.classList.add('briefing');
    this.startScreen.classList.add('visible');
  }

  hideStart(): void {
    this.root.classList.remove('briefing');
    this.startScreen.classList.remove('visible');
  }

  /** Reflect the chosen difficulty on the briefing screen. */
  setDifficulty(id: DifficultyId): void {
    const config = DIFFICULTIES[id];
    for (const button of this.startScreen.querySelectorAll<HTMLElement>('[data-difficulty]')) {
      const selected = button.dataset.difficulty === id;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', String(selected));
    }
    const strikes = this.startScreen.querySelector('[data-strike-count]');
    if (strikes) strikes.textContent = numberWord(config.ignitionTimes.length);
  }

  setBestLine(text: string | null): void {
    const line = this.startScreen.querySelector('[data-best]');
    if (!line) return;
    line.textContent = text ?? '';
    line.classList.toggle('visible', Boolean(text));
  }

  showEnd(result: ScenarioResult, best: BestRecord | null, newBest: boolean, saved: number): void {
    if (this.endShown) return;
    this.endShown = true;
    this.setTooltip(null);
    const won = result.status === 'won';
    const grade = result.grade ?? (won ? 'C' : 'F');
    const difficulty = DIFFICULTIES[result.difficulty];
    const bestLine = newBest
      ? '<p class="end-best new">New personal best for this map and difficulty.</p>'
      : best
        ? `<p class="end-best">Personal best here: ${best.score.toLocaleString()} (${best.grade})</p>`
        : '';
    this.endScreen.innerHTML = `
      <div class="end-card ${won ? 'win' : 'loss'}">
        <div class="end-kicker">${won ? 'SHIFT COMPLETE' : 'SHIFT FAILED'} · ${difficulty.label.toUpperCase()}</div>
        <div class="end-headline">
          <div class="grade-badge grade-${grade.toLowerCase()}" aria-label="Grade ${grade}">${grade}</div>
          <div>
            <h1>${won ? 'The ridge holds.' : 'The fire won.'}</h1>
            <p class="end-reason">${result.reason}</p>
          </div>
        </div>
        <div class="end-stats">
          <div><span>STRUCTURES</span><strong>${result.structuresStanding} standing</strong><em>${result.structuresLost} lost · ${saved} saved</em></div>
          <div><span>BURNED</span><strong>${result.burnedHectares.toFixed(2)} ha</strong><em>${result.backburnHectares > 0 ? `+${result.backburnHectares.toFixed(2)} ha backburned` : `${result.incidentsContained} incidents contained`}</em></div>
          <div><span>TIME</span><strong>${formatTime(result.elapsed)}</strong><em>${formatTime(result.remaining)} left</em></div>
          <div><span>SCORE</span><strong>${result.score.toLocaleString()}</strong><em>×${difficulty.scoreMultiplier} ${difficulty.label}</em></div>
        </div>
        ${bestLine}
        <div class="end-actions">
          <button type="button" class="secondary-button wide" data-action="replay">Replay this map</button>
          <button type="button" class="primary-button" data-action="restart">New Shift</button>
        </div>
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
    window.setTimeout(
      () => {
        item.classList.add('leaving');
        window.setTimeout(() => item.remove(), 380);
      },
      tone === 'hint' ? 8000 : 4600,
    );
  }

  /** Brief white-blue flash over the whole screen for a lightning strike. */
  lightning(): void {
    this.flash.classList.remove('strike');
    void this.flash.offsetWidth;
    this.flash.classList.add('strike');
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
    this.threatened = state.threats.buildings;
    this.drawMinimap(state);
    const now = performance.now();
    if (!force && now - this.lastHtmlUpdate < 160) return;
    this.lastHtmlUpdate = now;
    this.setMetric('time', formatTime(state.scenario.remaining));
    this.setSub('time', state.nextStrikeIn !== null && state.shiftTime > 0 ? `strike in ${formatTime(state.nextStrikeIn)}` : state.shiftTime > 0 ? 'storm passed' : '');
    this.setMetric('fires', String(state.fireActive));
    this.setMetric('structures', `${state.scenario.structuresStanding}`);
    this.setSub('structures', state.threats.total > 0 ? `${state.threats.total} at risk` : 'all safe', state.threats.total > 0 ? 'danger' : '');
    this.setMetric('budget', `$${Math.floor(state.funds).toLocaleString()}`);
    this.setSub('budget', `+${state.income.toFixed(1)}/s`);
    const budgetMetric = this.topbar.querySelector('[data-metric="budget"]');
    if (budgetMetric && Math.floor(state.funds) > this.lastFunds + 20) {
      budgetMetric.classList.remove('pulse');
      void (budgetMetric as HTMLElement).offsetWidth;
      budgetMetric.classList.add('pulse');
    }
    this.lastFunds = Math.floor(state.funds);
    this.setMetric('burned', `${state.burnedHectares.toFixed(2)} ha`);
    this.setSub('burned', `limit ${DIFFICULTIES[state.difficulty].burnLimitHectares.toFixed(1)} ha`);
    this.setMetric('wind', `${state.windSpeed.toFixed(1)} m/s ${compass(state.windDirection)}`);
    const next = state.nextWind;
    this.setSub(
      'wind',
      next && state.shiftTime > 0
        ? `→ ${compass(next.direction)} ${next.speed.toFixed(1)} in ${formatTime(next.time - state.shiftTime)}`
        : next
          ? `first shift ${formatTime(next.time)}`
          : 'steady',
      next && next.time - state.shiftTime < 20 && state.shiftTime > 0 ? 'warning' : '',
    );
    const windLabel = this.root.querySelector('[data-wind-label]');
    if (windLabel) windLabel.textContent = `${state.windSpeed.toFixed(1)} m/s`;
    const windCompass = this.root.querySelector('[data-wind-compass]');
    if (windCompass) windCompass.textContent = compass(state.windDirection);
    const windArrow = this.root.querySelector<HTMLElement>('.wind-arrow');
    if (windArrow) windArrow.style.transform = `rotate(${state.windDirection}rad)`;
    const forecastArrow = this.root.querySelector<HTMLElement>('.wind-arrow.forecast');
    if (forecastArrow) {
      forecastArrow.style.transform = `rotate(${next?.direction ?? state.windDirection}rad)`;
      forecastArrow.style.opacity = next ? '1' : '0';
    }
    this.topbar.querySelector('.objective-copy')!.textContent = state.scenario.reason;
    this.topbar.querySelector('.shift-fill')!.setAttribute('style', `width:${(1 - state.scenario.remaining / SHIFT_SECONDS) * 100}%`);
    this.updateTimeControls(state);
    this.renderIncidents(state);
    this.renderFleet(state);
    this.renderAid(state);
    this.renderUnitPanel(state);
    this.renderModeBanner(state);
    const auto = this.root.querySelector<HTMLInputElement>('#auto-dispatch');
    if (auto) auto.checked = state.autoDispatch;
    if (state.scenario.status === 'won' || state.scenario.status === 'lost') {
      this.showEnd(state.scenario, state.best, state.newBest, state.savedStructures);
    }
  }

  refreshMinimapBase(): void {
    this.renderMinimapBase();
  }

  private setMetric(name: string, value: string): void {
    const element = this.topbar.querySelector(`[data-metric="${name}"]`);
    if (element && element.textContent !== value) element.textContent = value;
  }

  private setSub(name: string, value: string, tone = ''): void {
    const element = this.topbar.querySelector<HTMLElement>(`[data-sub="${name}"]`);
    if (!element) return;
    if (element.textContent !== value) element.textContent = value;
    element.className = `metric-sub ${tone}`;
  }

  private template(seed: number): string {
    const difficultyButtons = DIFFICULTY_ORDER.map((id) => {
      const config = DIFFICULTIES[id];
      return `<button type="button" class="difficulty-option" role="radio" data-difficulty="${id}"><strong>${config.label}</strong><span>${config.tagline}</span></button>`;
    }).join('');
    return `
      <div class="vignette"></div>
      <div class="lightning-flash" id="lightning-flash"></div>
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
          <div class="metric"><span>${ICONS.clock} SHIFT</span><strong data-metric="time">08:00</strong><em class="metric-sub" data-sub="time"></em></div>
          <div class="metric"><span>${ICONS.flame} FIRES</span><strong data-metric="fires">0</strong></div>
          <div class="metric"><span>${ICONS.structure} STRUCTURES</span><strong data-metric="structures">0</strong><em class="metric-sub" data-sub="structures"></em></div>
          <div class="metric"><span>${ICONS.coin} BUDGET</span><strong data-metric="budget">$0</strong><em class="metric-sub" data-sub="budget"></em></div>
          <div class="metric secondary"><span>BURNED</span><strong data-metric="burned">0.00 ha</strong><em class="metric-sub" data-sub="burned"></em></div>
          <div class="metric wide"><span>${ICONS.wind} WIND</span><strong data-metric="wind">0.0 m/s</strong><em class="metric-sub" data-sub="wind"></em></div>
        </div>
        <div class="time-controls">
          <button type="button" class="icon-button" data-action="pause" aria-label="Pause">${ICONS.pause}</button>
          <div class="speed-group">
            <button type="button" data-speed="1" class="speed-button active">1x</button>
            <button type="button" data-speed="2" class="speed-button">2x</button>
            <button type="button" data-speed="4" class="speed-button">4x</button>
          </div>
          <button type="button" class="icon-button" data-action="mute" aria-label="Toggle sound">${ICONS.sound}</button>
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
            <span class="panel-note">Tab cycles</span>
          </div>
          <div class="fleet-list" id="fleet-list"></div>
          <div class="aid-panel" id="aid-panel"></div>
        </section>
      </aside>

      <section class="unit-panel panel" id="unit-panel"></section>

      <nav class="toolbar" id="toolbar" aria-label="Map tools">
        <button type="button" class="tool-button active" data-tool="select" aria-label="Select tool">
          <span class="tool-icon">${ICONS.cursor}</span><span class="tool-name">Command</span><kbd>V</kbd>
        </button>
        <button type="button" class="tool-button" data-tool="line" aria-label="Dozer line tool">
          <span class="tool-icon">${ICONS.dozer}</span><span class="tool-name">Dozer line</span><kbd>L</kbd>
        </button>
        <button type="button" class="tool-button" data-tool="road" aria-label="Road tool">
          <span class="tool-icon">${ICONS.road}</span><span class="tool-name">Road</span><kbd>B</kbd>
        </button>
        <button type="button" class="tool-button" data-tool="torch" aria-label="Backburn torch">
          <span class="tool-icon">${ICONS.torch}</span><span class="tool-name">Backburn</span><kbd>T</kbd>
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
            <h2>${regionName(seed)}</h2>
          </div>
          <span class="seed-label">SEED ${seed}</span>
        </div>
        <canvas id="minimap" width="220" height="220" aria-label="Map overview"></canvas>
        <div class="minimap-wind">
          <span class="wind-arrow"></span><strong data-wind-label>5.4 m/s</strong><em data-wind-compass>NW</em>
          <span class="forecast-label">next</span><span class="wind-arrow forecast"></span>
        </div>
        <div class="minimap-legend">
          <span><i class="legend-dot engine"></i>Engine</span>
          <span><i class="legend-dot air"></i>Air</span>
          <span><i class="legend-dot dozer"></i>Dozer</span>
          <span><i class="legend-dot fire"></i>Fire</span>
          <span><i class="legend-dot risk"></i>At risk</span>
        </div>
      </aside>

      <div class="tooltip" id="tooltip"></div>

      <div class="help-overlay" id="help-overlay">
        <div class="help-card">
          <button type="button" class="close-button" data-action="close-help" aria-label="Close">${ICONS.close}</button>
          <span class="panel-kicker">FIELD MANUAL</span>
          <h2>Command basics</h2>
          <div class="help-grid">
            <div><kbd>Left click</kbd><span>Select a unit, use the active tool, or send the selected unit at a fire.</span></div>
            <div><kbd>Right click</kbd><span>Move the selected unit. On a fire, the unit attacks it.</span></div>
            <div><kbd>L</kbd><span>Dozer line: click a start and an end. The nearest dozer cuts a permanent firebreak between them.</span></div>
            <div><kbd>B</kbd><span>Road: click a start and an end. $${ROAD_COST_PER_TILE} per new tile. New asphalt is a firebreak and gets hydrants.</span></div>
            <div><kbd>T</kbd><span>Backburn ($${TORCH_COST}): light fuel beside a road, line, or burned ground so the fire runs out of fuel. It turns wild if it runs too far.</span></div>
            <div><kbd>Tab</kbd><span>Cycle through units. Click a selected unit's card again to jump to it.</span></div>
            <div><kbd>W A S D</kbd><span>Pan the camera. <kbd>Q / E</kbd> rotate, <kbd>R / F</kbd> tilt, wheel zooms.</span></div>
            <div><kbd>Space</kbd><span>Pause. <kbd>1 / 2 / 4</kbd> set speed. <kbd>M</kbd> mutes sound.</span></div>
          </div>
          <p class="help-note">Read the wind forecast in the top bar: the fire's head runs downwind, and shifts swing it toward new targets. Engines need roads and water; parked beside a hydrant they never run dry. Helicopters dip from the lake when it is closer than the helipad. Dozers caught in the flames suffer a burnover and are out of service for a while. Containing an incident pays a budget bonus; spend it on roads, backburns, or mutual-aid units from the fleet panel.</p>
        </div>
      </div>

      <div class="start-screen visible" id="start-screen">
        <div class="start-backdrop"></div>
        <div class="start-card">
          <div class="start-flag">${regionName(seed).toUpperCase()} / AUGUST 17 / 16:40</div>
          <h1>CINDERLINE</h1>
          <p class="start-tagline">A wildfire command RTS. Read the wind. Hold the line.</p>
          <p class="start-copy"><span data-strike-count>Four</span> lightning strikes are forecast across the ridge. Protect the town, keep the roads open, and contain every fire before the eight-minute shift runs out.</p>
          <div class="difficulty-picker" role="radiogroup" aria-label="Difficulty">${difficultyButtons}</div>
          <div class="start-features">
            <div><strong>+</strong><span>Draw dozer lines, pave roads, and light backburns ahead of the head</span></div>
            <div><strong>+</strong><span>Engines, a dozer, a helicopter, an air tanker, and mutual aid on call</span></div>
            <div><strong>+</strong><span>Wind forecasts, spot fires, burnovers, and a budget earned by containment</span></div>
          </div>
          <div class="start-actions">
            <button type="button" class="primary-button" data-action="start">Start Shift</button>
            <span class="start-hint">WASD pan · Q/E rotate · wheel zoom · H manual</span>
          </div>
          <p class="start-best" data-best></p>
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
          this.callbacks.onRestart(false);
        } else if (action === 'replay') {
          this.callbacks.onRestart(true);
        } else if (action === 'pause') {
          this.callbacks.onPause();
        } else if (action === 'mute') {
          this.callbacks.onMute();
        } else if (action === 'help') {
          this.setHelp(true);
        } else if (action === 'close-help') {
          this.setHelp(false);
        }
        return;
      }
      const difficultyButton = target.closest<HTMLElement>('[data-difficulty]');
      if (difficultyButton) {
        const id = difficultyButton.dataset.difficulty;
        if (id === 'calm' || id === 'standard' || id === 'redflag') {
          this.setDifficulty(id);
          this.callbacks.onDifficulty(id);
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
        const tool = toolButton.dataset.tool;
        if (tool === 'select' || tool === 'torch' || tool === 'road' || tool === 'line') this.callbacks.onTool(tool);
        return;
      }
      const aidButton = target.closest<HTMLElement>('[data-aid]');
      if (aidButton) {
        const kind = aidButton.dataset.aid as UnitKind;
        if (kind) this.callbacks.onMutualAid(kind);
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
        if (id > 0 && (action === 'home' || action === 'hold' || action === 'attack' || action === 'line')) {
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
    const mute = this.topbar.querySelector<HTMLElement>('[data-action="mute"]');
    if (mute) {
      const icon = state.muted ? ICONS.muted : ICONS.sound;
      if (mute.dataset.muted !== String(state.muted)) {
        mute.innerHTML = icon;
        mute.dataset.muted = String(state.muted);
      }
    }
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
        const quiet = state.nextStrikeIn !== null ? 'Storm cell building. Stage your crews.' : 'No active incidents on the board.';
        this.incidentList.innerHTML = `<div class="empty-state"><span>All quiet.</span><em>${quiet}</em></div>`;
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
            <div class="incident-threat"></div>
            <div class="incident-assigned"></div>
          </div>
        `;
        const name = root.querySelector('strong') as HTMLElement;
        const subtitle = root.querySelector('.incident-top span') as HTMLElement;
        const threat = root.querySelector('.incident-threat') as HTMLElement;
        const assigned = root.querySelector('.incident-assigned') as HTMLElement;
        const dispatch = root.querySelector('.mini-button') as HTMLButtonElement;
        dispatch.dataset.dispatch = String(incident.id);
        this.incidentList.appendChild(root);
        refs = { root, name, subtitle, threat, assigned, dispatch };
        this.incidentCards.set(incident.id, refs);
      }
      refs.root.className = `incident-card ${severityClass(incident.severity)}`;
      const source = incident.source === 'spot' ? ' · spot' : incident.source === 'lightning' ? ' · lightning' : '';
      refs.name.textContent = this.world.sectorName(incident.tx, incident.tz);
      refs.subtitle.textContent = `${severityLabel(incident.severity)} · ${incident.severity} cells${source}`;
      const threatened = state.threats.byIncident.get(incident.id) ?? 0;
      refs.threat.textContent = threatened > 0 ? `Threatening ${threatened} structure${threatened === 1 ? '' : 's'}` : '';
      refs.threat.classList.toggle('visible', threatened > 0);
      const assignedNames = state.units
        .filter((unit) => unit.incidentId === incident.id)
        .map((unit) => unit.name);
      const html = assignedNames.length
        ? assignedNames.map((name) => `<span class="assigned-chip">${name}</span>`).join('')
        : '<span class="assigned-chip ghost">Unassigned</span>';
      if (refs.assigned.innerHTML !== html) refs.assigned.innerHTML = html;
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
        if (unit.mutualAid) root.classList.add('arrived');
      }
      const ratio = unit.capacity > 0 ? unit.water / unit.capacity : 0;
      const kindClass = unit.kind === 'helicopter' || unit.kind === 'tanker' ? 'air' : unit.kind === 'dozer' ? 'dozer' : 'engine';
      refs.root.classList.toggle('selected', unit.selected);
      refs.root.classList.toggle('out-of-service', unit.outOfService > 0);
      refs.root.classList.toggle('heat', unit.exposure > 0.25 && unit.outOfService <= 0);
      refs.badge.className = `unit-badge ${kindClass}`;
      refs.name.textContent = unit.mutualAid ? `${unit.name} · aid` : unit.name;
      refs.status.textContent = unit.exposure > 0.25 && unit.outOfService <= 0 ? `HEAT ${Math.round(unit.exposure * 100)}% · ${unit.status}` : unit.status;
      refs.water.textContent = unit.capacity > 0 ? `${Math.round(ratio * 100)}%` : '—';
    }
  }

  private renderAid(state: HudState): void {
    const running = state.scenario.status === 'running';
    const pending = state.reinforcements
      .map((item) => `<span class="aid-chip">${item.name} · ${Math.ceil(item.eta)}s</span>`)
      .join('');
    const buttons = AID_OPTIONS.map(({ kind, label }) => {
      const cost = MUTUAL_AID_COST[kind];
      const disabled = !running || state.mutualAidLeft <= 0 || state.funds < cost;
      return `<button type="button" class="aid-button" data-aid="${kind}" ${disabled ? 'disabled' : ''}>+ ${label}<b>$${cost}</b></button>`;
    }).join('');
    const html = `
      <div class="aid-head"><span>MUTUAL AID</span><em>${state.mutualAidLeft} of 3 left · arrives in 20 s</em></div>
      <div class="aid-buttons">${buttons}</div>
      ${pending ? `<div class="aid-pending">${pending}</div>` : ''}
    `;
    if (this.aidPanel.dataset.html !== html) {
      this.aidPanel.innerHTML = html;
      this.aidPanel.dataset.html = html;
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
    if (this.unitPanelId !== unit.id || this.unitPanelKind !== unit.kind) {
      const isAir = unit.kind === 'helicopter' || unit.kind === 'tanker';
      const isDozer = unit.kind === 'dozer';
      const payloadLabel = isAir ? 'PAYLOAD' : isDozer ? 'BLADE' : 'WATER';
      const primary = isDozer
        ? `<button type="button" class="secondary-button accent" data-unit-action="line" data-unit-id="${unit.id}">Draw line (L)</button>`
        : `<button type="button" class="secondary-button" data-unit-action="attack" data-unit-id="${unit.id}">Attack nearest</button>`;
      this.unitPanel.innerHTML = `
        <div class="unit-head">
          <div>
            <span class="panel-kicker">SELECTED UNIT · ${kindLabel(unit.kind)}</span>
            <h2>${unit.name}</h2>
          </div>
          <span class="unit-state"></span>
        </div>
        <div class="unit-bars">
          <div class="bar-label"><span>${payloadLabel}</span><strong></strong></div>
          <div class="meter"><span></span></div>
          <div class="bar-label heat-label"><span>HEAT STRESS</span><strong></strong></div>
          <div class="meter heat"><span></span></div>
          <div class="unit-flags"></div>
        </div>
        <div class="unit-actions">
          ${primary}
          <button type="button" class="secondary-button" data-unit-action="home" data-unit-id="${unit.id}">Return to base</button>
          <button type="button" class="secondary-button" data-unit-action="hold" data-unit-id="${unit.id}">Hold</button>
        </div>
        <p class="unit-tip">${unitTip(unit.kind)}</p>
      `;
      this.unitPanelId = unit.id;
      this.unitPanelKind = unit.kind;
    }
    const ratio = unit.capacity > 0 ? Math.max(0, Math.min(1, unit.water / unit.capacity)) : 1;
    this.unitPanel.classList.add('visible');
    const stateLabel = this.unitPanel.querySelector('.unit-state');
    const waterLabel = this.unitPanel.querySelector('.bar-label strong');
    const meter = this.unitPanel.querySelector('.meter span') as HTMLElement | null;
    const heatLabel = this.unitPanel.querySelector('.heat-label strong');
    const heatMeter = this.unitPanel.querySelector('.meter.heat span') as HTMLElement | null;
    const flags = this.unitPanel.querySelector('.unit-flags');
    if (stateLabel) stateLabel.textContent = unit.status;
    if (waterLabel) waterLabel.textContent = unit.capacity > 0 ? `${Math.round(unit.water)} / ${unit.capacity} L` : 'Ready';
    if (meter) meter.style.width = `${ratio * 100}%`;
    const showHeat = unit.kind !== 'helicopter' && unit.kind !== 'tanker';
    this.unitPanel.classList.toggle('show-heat', showHeat);
    if (heatLabel) heatLabel.textContent = unit.outOfService > 0 ? `out ${Math.ceil(unit.outOfService)} s` : `${Math.round(unit.exposure * 100)}%`;
    if (heatMeter) heatMeter.style.width = `${(unit.outOfService > 0 ? 1 : unit.exposure) * 100}%`;
    if (flags) {
      const html = `${unit.hydrantConnected ? '<span class="flag hydrant">HYDRANT FEED</span>' : ''}${
        unit.incidentId !== null ? `<span class="flag assigned">INCIDENT #${unit.incidentId}</span>` : ''
      }${unit.outOfService > 0 ? '<span class="flag danger">BURNOVER</span>' : ''}${unit.mutualAid ? '<span class="flag aid">MUTUAL AID</span>' : ''}`;
      if (flags.innerHTML !== html) flags.innerHTML = html;
    }
  }

  private renderModeBanner(state: HudState): void {
    if (state.tool === 'select') {
      this.modeBanner.classList.remove('visible');
      return;
    }
    this.modeBanner.classList.add('visible');
    let html: string;
    if (state.tool === 'torch') {
      html = `<strong>BACKBURN · $${TORCH_COST}</strong><span>Click fuel within 2 tiles of a road, dozer line, or burned ground, ahead of the fire. Esc exits.</span>`;
    } else if (state.tool === 'road') {
      const preview = state.preview
        ? `${state.preview.tiles} tiles · <b class="${state.preview.cost > state.funds ? 'short' : ''}">$${state.preview.cost}</b>`
        : 'no route';
      html = state.roadStart
        ? `<strong>ROAD</strong><span>Click the destination. ${preview}. Esc cancels.</span>`
        : `<strong>ROAD · $${ROAD_COST_PER_TILE}/TILE</strong><span>Click a start tile. New asphalt stops fire and brings hydrants.</span>`;
    } else {
      const preview = state.preview ? `${state.preview.tiles} tiles` : 'no clear ground';
      html = state.lineStart
        ? `<strong>DOZER LINE</strong><span>Click where the line ends. ${preview}. Esc cancels.</span>`
        : `<strong>DOZER LINE · FREE</strong><span>Click where the line starts. Cut ahead of the head, across the wind.</span>`;
    }
    if (this.modeBanner.innerHTML !== html) this.modeBanner.innerHTML = html;
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
      const controlled = (this.fire.controlled[i] ?? 0) > 0;
      if (fireState === 1 || fireState === 2) {
        ctx.fillStyle = controlled ? '#ffb347' : '#ff5a24';
      } else if (fireState === 3) {
        ctx.fillStyle = '#7a3a2a';
      } else if (fireState === 4) {
        ctx.fillStyle = controlled ? '#3d3127' : '#2b2520';
      } else {
        ctx.fillStyle = '#d8c79a';
      }
      ctx.fillRect(tx * scale, tz * scale, scale, scale);
    }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    if (this.threatened.size > 0) {
      ctx.strokeStyle = `rgba(255, 92, 70, ${0.55 + pulse * 0.45})`;
      ctx.lineWidth = 1.6;
      for (const building of this.world.buildings.buildings) {
        if (!this.threatened.has(building.id)) continue;
        ctx.strokeRect(building.x0 * scale - 1.5, building.z0 * scale - 1.5, building.worldW * scale + 3, building.worldD * scale + 3);
      }
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
      if (unit.outOfService > 0) ctx.fillStyle = '#8b8b80';
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
    const viewWidth = ((this.lastCameraView?.width ?? 66) / WORLD_SIZE) * w;
    const viewHeight = ((this.lastCameraView?.height ?? 66) / WORLD_SIZE) * h;
    const cx = ((this.lastCameraView?.x ?? WORLD_SIZE / 2) / WORLD_SIZE) * w;
    const cy = ((this.lastCameraView?.z ?? WORLD_SIZE / 2) / WORLD_SIZE) * h;
    ctx.strokeRect(cx - viewWidth / 2, cy - viewHeight / 2, viewWidth, viewHeight);
  }

  lastCameraView: { x: number; z: number; width: number; height: number } | null = null;

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element ${selector}`);
    return element;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'firetruck':
      return 'FIRE ENGINE';
    case 'dozer':
      return 'BULLDOZER';
    case 'helicopter':
      return 'HELICOPTER';
    default:
      return 'AIR TANKER';
  }
}

function unitTip(kind: string): string {
  switch (kind) {
    case 'firetruck':
      return 'Road-bound. Parks within hose reach, beside a hydrant when it can. Right-click a fire to attack it.';
    case 'dozer':
      return 'Press L and click two points to cut a line. Keep it out of the flames: burnovers take it out of service.';
    case 'helicopter':
      return 'Drops on the downwind head, then dips from the lake if it is closer than the helipad.';
    default:
      return 'Lays a long retardant line across the wind ahead of the head. Slow to reload.';
  }
}

function numberWord(n: number): string {
  return ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][n] ?? String(n);
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

const REGION_FIRST = ['Raven', 'Cedar', 'Coyote', 'Juniper', 'Sawtooth', 'Manzanita', 'Bitterroot', 'Lone Pine', 'Granite', 'Sage'];
const REGION_LAST = ['Ridge', 'Basin', 'Canyon', 'Flats', 'Bench', 'Hollow', 'Mesa', 'Divide'];

/** Deterministic place name for a seeded map. */
export function regionName(seed: number): string {
  return `${REGION_FIRST[seed % REGION_FIRST.length]} ${REGION_LAST[Math.floor(seed / REGION_FIRST.length) % REGION_LAST.length]}`;
}
