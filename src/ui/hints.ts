import { loadJson, saveJson } from '../core/prefs';
import { NotifyFn } from '../sim/types';

export type HintId = 'welcome' | 'line' | 'forecast' | 'threat' | 'hydrant' | 'aid' | 'backburn' | 'heat';

const HINT_TEXT: Record<HintId, string> = {
  welcome: 'Tip: auto-dispatch handles first response. Select a unit and right-click to take command yourself.',
  line: 'Tip: press L and click two points to have the dozer cut a firebreak across the head of the fire.',
  forecast: 'Tip: the top bar shows the next wind shift. The head will swing that way, so cut lines where it is going.',
  threat: 'Tip: structures at risk pulse red on the minimap. Put engines or a line between the fire and town.',
  hydrant: 'Tip: engines refill at hydrants: the cyan rings along the roads and dots on the minimap. One parked beside a hydrant sprays forever; new roads (B) bring new hydrants.',
  aid: 'Tip: budget piling up? Call mutual aid from the fleet panel. It arrives in 20 seconds.',
  backburn: 'Tip: a big head fire? Press T and light a backburn beside a road ahead of it to starve it of fuel.',
  heat: 'Tip: your dozer is taking heat. Pull it back before a burnover takes it out of service.',
};

/** Minimum real time (ms) between two coaching toasts. */
const HINT_SPACING_MS = 22000;

/** One-time coaching toasts. Each hint shows once per browser, ever, and never two at once. */
export class Hints {
  private readonly seen: Set<HintId>;
  private lastShown = -Infinity;

  constructor(private readonly notify: NotifyFn) {
    this.seen = new Set(loadJson<HintId[]>('hints', []));
  }

  show(id: HintId): void {
    if (this.seen.has(id)) return;
    const now = performance.now();
    if (now - this.lastShown < HINT_SPACING_MS) return;
    this.lastShown = now;
    this.seen.add(id);
    saveJson('hints', [...this.seen]);
    this.notify(HINT_TEXT[id], 'hint');
  }

  has(id: HintId): boolean {
    return this.seen.has(id);
  }
}
