let _overlay: HTMLDivElement | null = null;

function ensureOverlay(container: HTMLElement) {
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = '12px';
  el.style.top = '36px';
  el.style.maxWidth = '40vw';
  el.style.padding = '6px 8px';
  el.style.background = 'rgba(127, 29, 29, 0.85)'; // red-700 w/ alpha
  el.style.color = '#ffe4e6';
  el.style.font = '12px/1.3 system-ui, sans-serif';
  el.style.whiteSpace = 'pre-wrap';
  el.style.border = '1px solid rgba(254, 226, 226, 0.35)';
  el.style.borderRadius = '6px';
  el.style.zIndex = '9999';
  el.style.display = 'none';

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';
  title.textContent = 'Runtime Error';
  const body = document.createElement('div');
  body.className = 'err-body';
  const actions = document.createElement('div');
  actions.style.marginTop = '6px';
  const clear = document.createElement('a');
  clear.href = '#'; clear.textContent = 'Clear';
  clear.style.cssText = 'color:#fecaca;text-decoration:underline;cursor:pointer;margin-right:8px;';
  clear.onclick = (e) => { e.preventDefault(); el.style.display = 'none'; };
  const copy = document.createElement('a');
  copy.href = '#'; copy.textContent = 'Copy';
  copy.style.cssText = 'color:#fecaca;text-decoration:underline;cursor:pointer;';
  copy.onclick = async (e) => {
    e.preventDefault();
    const txt = body.textContent || '';
    try { await navigator.clipboard.writeText(txt); } catch {}
  };
  actions.appendChild(clear); actions.appendChild(copy);
  el.appendChild(title); el.appendChild(body); el.appendChild(actions);
  container.appendChild(el);
  _overlay = el;
  return el;
}

export function showErrorOverlay(container: HTMLElement, message: string, stack?: string) {
  const el = ensureOverlay(container);
  const body = el.querySelector('.err-body') as HTMLDivElement;
  body.textContent = message + (stack ? '\n' + stack : '');
  el.style.display = 'block';
}

export function installGlobalErrorOverlay(container: HTMLElement) {
  ensureOverlay(container);
  window.addEventListener('error', (e) => {
    const msg = `${e.message || 'Error'}\n@ ${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`;
    const st = (e.error && (e.error as any).stack) ? String((e.error as any).stack) : undefined;
    console.error('[runtime error]', e.error || e);
    showErrorOverlay(container, msg, st);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason: any = (e as any).reason;
    const msg = 'Unhandled Rejection: ' + (reason && reason.message ? reason.message : String(reason));
    const st = reason && reason.stack ? String(reason.stack) : undefined;
    console.error('[unhandled rejection]', reason);
    showErrorOverlay(container, msg, st);
  });
}

