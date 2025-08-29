export type StatsHandle = {
  update: (dt: number, renderer: import('three').WebGLRenderer) => void;
};

export function attachStats(container: HTMLElement): StatsHandle {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.right = '12px';
  el.style.top = '8px';
  el.style.padding = '6px 8px';
  el.style.background = 'rgba(0,0,0,0.4)';
  el.style.font = '12px/1.2 system-ui, sans-serif';
  el.style.color = '#e5e7eb';
  el.style.whiteSpace = 'pre';
  container.appendChild(el);

  let acc = 0;
  let frames = 0;
  let fps = 0;

  return {
    update(dt, renderer) {
      acc += dt; frames++;
      if (acc >= 0.5) { fps = Math.round(frames / acc); acc = 0; frames = 0; }
      const info = renderer.info;
      el.textContent = `FPS ${fps}\nCalls ${info.render.calls}  Tris ${info.render.triangles}`;
      // reset auto counters each frame
      info.reset();
    }
  };
}

