export type StatsHandle = {
  update: (dt: number, renderer: import('three').WebGLRenderer) => void;
  getIgniteMode: () => boolean;
  setActions: (a: {
    igniteCenter?: () => void;
    setVizMode?: (mode: 'overlay' | 'raised' | 'vertex') => void;
    roads?: { toggle?: (on: boolean) => void; clear?: () => void };
    vehicles?: { spawn?: () => void; moveModeToggle?: (on: boolean) => void; clear?: () => void };
    preset?: { set?: (variant: 'loop' | 'figure8') => void };
  }) => void;
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
  let actions: {
    igniteCenter?: () => void;
    setVizMode?: (mode: 'overlay' | 'raised' | 'vertex') => void;
    roads?: { toggle?: (on: boolean) => void; clear?: () => void };
    vehicles?: { spawn?: () => void; moveModeToggle?: (on: boolean) => void; clear?: () => void };
    preset?: { set?: (variant: 'loop' | 'figure8') => void };
  } = {};

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
  // Fire viz mode dropdown
  const vizLabel = document.createElement('span');
  vizLabel.textContent = 'Fire Viz:';
  vizLabel.style.marginRight = '6px';
  vizLabel.style.marginLeft = '8px';
  vizLabel.style.color = '#cbd5e1';
  const select = document.createElement('select');
  select.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:1px 4px;';
  for (const opt of ['overlay','raised','vertex'] as const) {
    const o = document.createElement('option');
    o.value = opt; o.text = opt;
    select.appendChild(o);
  }
  select.value = 'vertex';
  select.addEventListener('change', () => actions.setVizMode?.(select.value as any));
  row.appendChild(vizLabel);
  row.appendChild(select);
  // Roads controls
  const roadsLabel = document.createElement('span');
  roadsLabel.textContent = 'Roads:';
  roadsLabel.style.marginLeft = '8px';
  roadsLabel.style.marginRight = '6px';
  roadsLabel.style.color = '#cbd5e1';
  const roadsToggle = document.createElement('a');
  roadsToggle.href = '#';
  roadsToggle.style.cssText = linkStyle;
  let roadsOn = false;
  roadsToggle.textContent = 'Off';
  roadsToggle.addEventListener('click', (e) => {
    e.preventDefault();
    roadsOn = !roadsOn;
    roadsToggle.textContent = roadsOn ? 'On' : 'Off';
    actions.roads?.toggle?.(roadsOn);
  });
  const roadsClear = document.createElement('a');
  roadsClear.href = '#';
  roadsClear.style.cssText = linkStyle;
  roadsClear.textContent = 'Clear Roads';
  roadsClear.addEventListener('click', (e) => { e.preventDefault(); actions.roads?.clear?.(); });
  row.appendChild(roadsLabel);
  row.appendChild(roadsToggle);
  row.appendChild(roadsClear);

  // Map preset selector (added dynamically if provided by caller)
  let presetInjected = false;
  const maybeInjectPreset = () => {
    if (presetInjected || !actions.preset?.set) return;
    const presetLabel = document.createElement('span');
    presetLabel.textContent = 'Map:';
    presetLabel.style.marginLeft = '8px';
    presetLabel.style.marginRight = '6px';
    presetLabel.style.color = '#cbd5e1';
    const presetSelect = document.createElement('select');
    presetSelect.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:1px 4px;';
    const presetOpts = [
      { v: 'loop', t: 'Loop' },
      { v: 'figure8', t: 'Figure-8' },
    ] as const;
    for (const o of presetOpts) {
      const opt = document.createElement('option');
      opt.value = o.v; opt.text = o.t; presetSelect.appendChild(opt);
    }
    presetSelect.value = 'loop';
    presetSelect.addEventListener('change', () => actions.preset?.set?.(presetSelect.value as any));
    row.appendChild(presetLabel);
    row.appendChild(presetSelect);
    presetInjected = true;
  };

  // Vehicles controls
  const vehLabel = document.createElement('span');
  vehLabel.textContent = 'Vehicles:';
  vehLabel.style.marginLeft = '8px';
  vehLabel.style.marginRight = '6px';
  vehLabel.style.color = '#cbd5e1';
  const vehSpawn = document.createElement('a');
  vehSpawn.href = '#';
  vehSpawn.style.cssText = linkStyle;
  vehSpawn.textContent = 'Spawn';
  vehSpawn.addEventListener('click', (e) => { e.preventDefault(); actions.vehicles?.spawn?.(); });
  const vehMove = document.createElement('a');
  vehMove.href = '#';
  vehMove.style.cssText = linkStyle;
  let vehMoveOn = false;
  vehMove.textContent = 'Move: Off';
  vehMove.addEventListener('click', (e) => {
    e.preventDefault();
    vehMoveOn = !vehMoveOn;
    vehMove.textContent = `Move: ${vehMoveOn ? 'On' : 'Off'}`;
    actions.vehicles?.moveModeToggle?.(vehMoveOn);
  });
  const vehClear = document.createElement('a');
  vehClear.href = '#';
  vehClear.style.cssText = linkStyle;
  vehClear.textContent = 'Clear';
  vehClear.addEventListener('click', (e) => { e.preventDefault(); actions.vehicles?.clear?.(); });
  row.appendChild(vehLabel);
  row.appendChild(vehSpawn);
  row.appendChild(vehMove);
  row.appendChild(vehClear);
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
    setActions(a) { actions = a; maybeInjectPreset(); }
  };
}
