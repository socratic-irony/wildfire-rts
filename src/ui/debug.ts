export type StatsHandle = {
  update: (dt: number, renderer: import('three').WebGLRenderer) => void;
  getIgniteMode: () => boolean;
  setActions: (a: {
    igniteCenter?: () => void;
    setVizMode?: (mode: 'overlay' | 'raised' | 'vertex') => void;
    roads?: { toggle?: (on: boolean) => void; clear?: () => void };
    vehicles?: { spawn?: () => void; moveModeToggle?: (on: boolean) => void; clear?: () => void; toggleYawDebug?: (on: boolean) => void; toggleYawSmoothing?: (on: boolean) => void; setFollowMode?: (m: 'grid' | 'frenet') => void; setSpacingMode?: (m: 'hybrid' | 'gap' | 'time') => void };
    preset?: { set?: (variant: 'loop' | 'figure8') => void };
    config?: {
      get?: () => any;
      set?: (partial: any) => void;
      regenerate?: () => void;
    };
  }) => void;
  setRefs?: (opts: DebugOpts) => void;
};

type DebugOpts = {
  chunkGroup?: import('three').Group;
  forest?: { leaves: import('three').InstancedMesh; trunks: import('three').InstancedMesh; broadLeaves?: import('three').InstancedMesh; broadTrunks?: import('three').InstancedMesh };
  shrubs?: { inst: import('three').InstancedMesh };
  rocks?: { inst: import('three').InstancedMesh };
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
    vehicles?: { spawn?: () => void; moveModeToggle?: (on: boolean) => void; clear?: () => void; toggleYawDebug?: (on: boolean) => void; toggleYawSmoothing?: (on: boolean) => void; setFollowMode?: (m: 'grid' | 'frenet') => void; setSpacingMode?: (m: 'hybrid' | 'gap' | 'time') => void };
    preset?: { set?: (variant: 'loop' | 'figure8') => void };
    config?: { get?: () => any; set?: (partial: any) => void; regenerate?: () => void };
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
  // (Turn mode removed; Frenet handles yaw)
  // Follow mode selector
  const followLabel = document.createElement('span');
  followLabel.textContent = 'Follow:';
  followLabel.style.marginLeft = '8px';
  followLabel.style.marginRight = '6px';
  followLabel.style.color = '#cbd5e1';
  const followSelect = document.createElement('select');
  followSelect.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:1px 4px;';
  for (const opt of ['grid','frenet'] as const) {
    const o = document.createElement('option');
    o.value = opt; o.text = opt; followSelect.appendChild(o);
  }
  followSelect.value = 'frenet';
  followSelect.addEventListener('change', () => actions.vehicles?.setFollowMode?.(followSelect.value as any));
  // Spacing mode selector
  const spaceLabel = document.createElement('span');
  spaceLabel.textContent = 'Spacing:';
  spaceLabel.style.marginLeft = '8px';
  spaceLabel.style.marginRight = '6px';
  spaceLabel.style.color = '#cbd5e1';
  const spaceSelect = document.createElement('select');
  spaceSelect.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:1px 4px;';
  for (const opt of ['hybrid','gap','time'] as const) {
    const o = document.createElement('option'); o.value = opt; o.text = opt; spaceSelect.appendChild(o);
  }
  spaceSelect.value = 'hybrid';
  spaceSelect.addEventListener('change', () => actions.vehicles?.setSpacingMode?.(spaceSelect.value as any));
  // Yaw smoothing toggle
  const yawSmooth = document.createElement('a');
  yawSmooth.href = '#';
  yawSmooth.style.cssText = linkStyle;
  let yawSmoothOn = true;
  yawSmooth.textContent = 'Yaw Smooth: On';
  yawSmooth.addEventListener('click', (e) => {
    e.preventDefault();
    yawSmoothOn = !yawSmoothOn;
    yawSmooth.textContent = `Yaw Smooth: ${yawSmoothOn ? 'On' : 'Off'}`;
    actions.vehicles?.toggleYawSmoothing?.(yawSmoothOn);
  });
  row.appendChild(vehLabel);
  row.appendChild(vehSpawn);
  row.appendChild(vehMove);
  row.appendChild(vehClear);
  const yawDbg = document.createElement('a');
  yawDbg.href = '#';
  yawDbg.style.cssText = linkStyle;
  let yawOn = false;
  yawDbg.textContent = 'Yaw Debug: Off';
  yawDbg.addEventListener('click', (e) => {
    e.preventDefault();
    yawOn = !yawOn;
    yawDbg.textContent = `Yaw Debug: ${yawOn ? 'On' : 'Off'}`;
    actions.vehicles?.toggleYawDebug?.(yawOn);
  });
  row.appendChild(yawDbg);
  // (Turn selector removed)
  row.appendChild(followLabel);
  row.appendChild(followSelect);
  row.appendChild(spaceLabel);
  row.appendChild(spaceSelect);
  row.appendChild(yawSmooth);
  el.appendChild(row);

  // Sliders panel
  const panel = document.createElement('div');
  panel.style.marginTop = '6px';
  panel.style.paddingTop = '6px';
  panel.style.borderTop = '1px solid #374151';
  // Collapsible toggle to show/hide heavy biome panel
  const panelToggle = document.createElement('a');
  panelToggle.href = '#';
  panelToggle.style.cssText = 'display:inline-block;margin:4px 0;color:#93c5fd; text-decoration:underline; cursor:pointer;';
  let panelVisible = true;
  const updatePanelToggleText = () => { panelToggle.textContent = panelVisible ? 'Hide Biome Panel' : 'Show Biome Panel'; };
  updatePanelToggleText();
  panelToggle.onclick = (e) => {
    e.preventDefault();
    panelVisible = !panelVisible;
    (panel as HTMLDivElement).style.display = panelVisible ? 'block' : 'none';
    updatePanelToggleText();
  };
  el.appendChild(panelToggle);
  const mkLabel = (text: string) => { const s = document.createElement('div'); s.textContent = text; s.style.color = '#cbd5e1'; s.style.margin = '6px 0 2px'; return s; };
  const mkRange = (id: string, min: number, max: number, step: number, val: number) => {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(val);
    input.style.width = '180px'; input.style.verticalAlign = 'middle'; input.id = id;
    const span = document.createElement('span'); span.style.marginLeft = '8px'; span.textContent = String(val);
    input.addEventListener('input', () => { span.textContent = input.value; });
    wrap.appendChild(input); wrap.appendChild(span);
    return { wrap, input };
  };
  const mkText = (id: string, val: string) => {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text'; input.value = val; input.id = id;
    input.style.cssText = 'width:120px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:2px 4px;';
    wrap.appendChild(input);
    return { wrap, input };
  };
  const cfg = () => actions.config?.get?.() ?? {};

  // Terrain size (regenerate required)
  panel.appendChild(mkLabel('Terrain Size'));
  const size = mkRange('terrainSize', 64, 512, 32, cfg().width ?? 128);
  panel.appendChild(size.wrap);

  // Noise controls
  panel.appendChild(mkLabel('Noise: frequency / amplitude'));
  const freq = mkRange('noiseFreq', 0.2, 6.0, 0.1, cfg().noise?.frequency ?? 2.0);
  const amp = mkRange('noiseAmp', 1, 20, 1, cfg().noise?.amplitude ?? 8);
  panel.appendChild(freq.wrap); panel.appendChild(amp.wrap);
  // Noise seed
  panel.appendChild(mkLabel('Noise Seed'));
  const noiseSeed = mkText('noiseSeed', String(cfg().noise?.seed ?? '42'));
  const nsRand = document.createElement('a'); nsRand.href = '#'; nsRand.textContent = 'Randomize'; nsRand.style.cssText = 'color:#93c5fd; text-decoration:underline; cursor:pointer; margin-left:8px;';
  nsRand.onclick = (e) => { e.preventDefault(); noiseSeed.input.value = Math.random().toString(36).slice(2, 8); };
  const nsRow = document.createElement('div'); nsRow.appendChild(noiseSeed.wrap); nsRow.appendChild(nsRand); panel.appendChild(nsRow);

  // Biome moisture threshold
  panel.appendChild(mkLabel('Forest Moisture Min'));
  const fmoist = mkRange('forestMoist', 0.0, 1.0, 0.01, cfg().biomes?.forestMoistureMin ?? 0.55);
  panel.appendChild(fmoist.wrap);
  // Moisture seed
  panel.appendChild(mkLabel('Moisture Seed'));
  const moistSeed = mkText('moistSeed', String(cfg().moisture?.seed ?? 'moist'));
  const msRand = document.createElement('a'); msRand.href = '#'; msRand.textContent = 'Randomize'; msRand.style.cssText = 'color:#93c5fd; text-decoration:underline; cursor:pointer; margin-left:8px;';
  msRand.onclick = (e) => { e.preventDefault(); moistSeed.input.value = Math.random().toString(36).slice(2, 8); };
  const msRow = document.createElement('div'); msRow.appendChild(moistSeed.wrap); msRow.appendChild(msRand); panel.appendChild(msRow);

  // Densities
  panel.appendChild(mkLabel('Densities: trees / shrubs / rocks'));
  const dTrees = mkRange('densTrees', 0.0, 0.6, 0.01, cfg().densities?.tree ?? 0.30);
  const dShrubs = mkRange('densShrubs', 0.0, 0.4, 0.01, cfg().densities?.shrub ?? 0.15);
  const dRocks = mkRange('densRocks', 0.0, 0.2, 0.01, cfg().densities?.rock ?? 0.08);
  panel.appendChild(dTrees.wrap); panel.appendChild(dShrubs.wrap); panel.appendChild(dRocks.wrap);

  // Broadleaf ratio
  panel.appendChild(mkLabel('Broadleaf Ratio'));
  const broadRatio = mkRange('broadRatio', 0.0, 1.0, 0.01, cfg().densities?.broadleafRatio ?? 0.4);
  panel.appendChild(broadRatio.wrap);

  // Apply + Regenerate buttons
  const btnRow = document.createElement('div');
  btnRow.style.marginTop = '6px';
  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply (no regen)';
  applyBtn.style.cssText = 'margin-right:8px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:2px 6px;cursor:pointer;';
  const regenBtn = document.createElement('button');
  regenBtn.textContent = 'Regenerate Terrain';
  regenBtn.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:2px 6px;cursor:pointer;';
  const readVals = () => ({
    width: Number(size.input.value), height: Number(size.input.value),
    noise: { frequency: Number(freq.input.value), amplitude: Number(amp.input.value), seed: noiseSeed.input.value },
    moisture: { seed: moistSeed.input.value },
    biomes: { forestMoistureMin: Number(fmoist.input.value) },
    densities: { tree: Number(dTrees.input.value), shrub: Number(dShrubs.input.value), rock: Number(dRocks.input.value), broadleafRatio: Number(broadRatio.input.value) }
  });
  applyBtn.onclick = () => actions.config?.set?.(readVals());
  regenBtn.onclick = () => { actions.config?.set?.(readVals()); actions.config?.regenerate?.(); };
  // Randomize both seeds helper
  const randBoth = document.createElement('button');
  randBoth.textContent = 'Randomize Seeds + Regen';
  randBoth.style.cssText = 'margin-left:8px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:2px 6px;cursor:pointer;';
  randBoth.onclick = () => { noiseSeed.input.value = Math.random().toString(36).slice(2, 8); moistSeed.input.value = Math.random().toString(36).slice(2, 8); actions.config?.set?.(readVals()); actions.config?.regenerate?.(); };
  btnRow.appendChild(applyBtn); btnRow.appendChild(regenBtn);
  btnRow.appendChild(randBoth);
  panel.appendChild(btnRow);

  el.appendChild(panel);

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
      const treeConifer = opts.forest ? ((opts.forest.leaves as any).count ?? (opts.forest.leaves as any).instanceCount ?? 0) : 0;
      const treeBroad = opts.forest?.broadLeaves ? (((opts.forest.broadLeaves as any).count ?? (opts.forest.broadLeaves as any).instanceCount) ?? 0) : 0;
      const treeCount = treeConifer + treeBroad;
      const shrubCount = opts.shrubs ? ((opts.shrubs.inst as any).count ?? (opts.shrubs.inst as any).instanceCount ?? 0) : 0;
      const rockCount = opts.rocks ? ((opts.rocks.inst as any).count ?? (opts.rocks.inst as any).instanceCount ?? 0) : 0;

      const statsText =
        `FPS ${fps}\n` +
        `Calls ${info.render.calls}  Tris ${info.render.triangles}\n` +
        (opts.chunkGroup ? `Chunks ${chunksVis}/${chunks}  LOD H:${lodHi} L:${lodLo}\n` : '') +
        (opts.forest || opts.shrubs || opts.rocks ? `Instances Trees ${treeCount}${treeBroad?` (broad ${treeBroad})`:''}  Shrubs ${shrubCount}  Rocks ${rockCount}` : '');
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
    setActions(a) { actions = a; maybeInjectPreset(); },
    setRefs(o) { opts = o; }
  };
}
