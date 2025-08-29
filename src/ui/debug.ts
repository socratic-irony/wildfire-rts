export type StatsHandle = {
  update: (dt: number, renderer: import('three').WebGLRenderer) => void;
  getIgniteMode: () => boolean;
  setActions: (a: { igniteCenter?: () => void }) => void;
};

type DebugOpts = {
  chunkGroup?: import('three').Group;
  forest?: { leaves: import('three').InstancedMesh; trunks: import('three').InstancedMesh };
  shrubs?: { inst: import('three').InstancedMesh };
};

export function attachStats(container: HTMLElement, opts: DebugOpts = {}): StatsHandle {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.right = '12px';
  el.style.top = '8px';
  el.style.padding = '6px 8px';
  el.style.background = 'rgba(0,0,0,0.45)';
  el.style.backdropFilter = 'blur(2px)';
  el.style.font = '12px/1.2 system-ui, sans-serif';
  el.style.color = '#e5e7eb';
  el.style.whiteSpace = 'pre';
  el.style.pointerEvents = 'auto';
  el.title = 'F1 to toggle';
  container.appendChild(el);

  let acc = 0;
  let frames = 0;
  let fps = 0;
  let visible = true;
  let igniteMode = false;
  let actions: { igniteCenter?: () => void } = {};

  // Controls row
  const row = document.createElement('div');
  row.style.marginBottom = '4px';
  const linkStyle = 'color:#93c5fd; text-decoration:underline; cursor:pointer; margin-right:8px;';
  const igniteToggle = document.createElement('a');
  igniteToggle.href = '#';
  igniteToggle.style.cssText = linkStyle;
  igniteToggle.textContent = 'Ignite: Off';
  igniteToggle.addEventListener('click', (e) => {
    e.preventDefault();
    igniteMode = !igniteMode;
    igniteToggle.textContent = `Ignite: ${igniteMode ? 'On' : 'Off'}`;
  });
  const igniteCenter = document.createElement('a');
  igniteCenter.href = '#';
  igniteCenter.style.cssText = linkStyle;
  igniteCenter.textContent = 'Ignite Center';
  igniteCenter.addEventListener('click', (e) => {
    e.preventDefault();
    actions.igniteCenter?.();
  });
  row.appendChild(igniteToggle);
  row.appendChild(igniteCenter);
  el.appendChild(row);

  // Toggle with F1
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1' || e.key === 'f1') {
      visible = !visible;
      el.style.display = visible ? 'block' : 'none';
      e.preventDefault();
    }
  });

  return {
    update(dt, renderer) {
      acc += dt; frames++;
      if (acc >= 0.5) { fps = Math.round(frames / acc); acc = 0; frames = 0; }
      const info = renderer.info;

      // Chunk stats (if available)
      let chunks = 0, chunksVis = 0, lodHi = 0, lodLo = 0;
      if (opts.chunkGroup) {
        const children = opts.chunkGroup.children as any[];
        chunks = children.length;
        for (const m of children) {
          if (m.visible) {
            chunksVis++;
            if (m.geometry === m.userData?.geoHi) lodHi++; else lodLo++;
          }
        }
      }

      // Instance counts (if available)
      const treeCount = opts.forest ? ((opts.forest.leaves as any).count ?? (opts.forest.leaves as any).instanceCount ?? 0) : 0;
      const shrubCount = opts.shrubs ? ((opts.shrubs.inst as any).count ?? (opts.shrubs.inst as any).instanceCount ?? 0) : 0;

      const statsText =
        `FPS ${fps}\n` +
        `Calls ${info.render.calls}  Tris ${info.render.triangles}\n` +
        (opts.chunkGroup ? `Chunks ${chunksVis}/${chunks}  LOD H:${lodHi} L:${lodLo}\n` : '') +
        (opts.forest || opts.shrubs ? `Instances Trees ${treeCount}  Shrubs ${shrubCount}` : '');
      // Ensure stats lines sit below controls row
      let lines = el.querySelector('.lines') as HTMLDivElement | null;
      if (!lines) {
        lines = document.createElement('div');
        lines.className = 'lines';
        el.appendChild(lines);
      }
      lines.textContent = statsText;

      // reset auto counters each frame
      info.reset();
    },
    getIgniteMode() { return igniteMode; },
    setActions(a) { actions = a; }
  };
}
