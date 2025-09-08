import { getLogger } from '../../tools/logging/index.js';

let _overlay: HTMLDivElement | null = null;
let _errorHistory: ErrorReport[] = [];

interface ErrorReport {
  timestamp: string;
  message: string;
  stack?: string;
  location?: string;
  userAgent: string;
  url: string;
  type: 'error' | 'unhandledrejection';
}

function ensureOverlay(container: HTMLElement) {
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = '12px';
  el.style.top = '36px';
  el.style.maxWidth = '50vw';
  el.style.maxHeight = '60vh';
  el.style.padding = '8px 10px';
  el.style.background = 'rgba(127, 29, 29, 0.90)'; // red-700 w/ alpha
  el.style.color = '#ffe4e6';
  el.style.font = '11px/1.4 system-ui, sans-serif';
  el.style.whiteSpace = 'pre-wrap';
  el.style.border = '1px solid rgba(254, 226, 226, 0.35)';
  el.style.borderRadius = '6px';
  el.style.zIndex = '9999';
  el.style.display = 'none';
  el.style.overflow = 'auto';

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.marginBottom = '6px';
  title.style.fontSize = '13px';
  title.textContent = 'Runtime Error';
  
  const body = document.createElement('div');
  body.className = 'err-body';
  body.style.marginBottom = '8px';
  body.style.maxHeight = '40vh';
  body.style.overflow = 'auto';
  body.style.padding = '4px';
  body.style.background = 'rgba(0, 0, 0, 0.2)';
  body.style.borderRadius = '3px';
  
  const actions = document.createElement('div');
  actions.style.marginTop = '8px';
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.flexWrap = 'wrap';
  
  const clear = document.createElement('a');
  clear.href = '#'; clear.textContent = 'Clear';
  clear.style.cssText = 'color:#fecaca;text-decoration:underline;cursor:pointer;font-size:11px;';
  clear.onclick = (e) => { e.preventDefault(); el.style.display = 'none'; };
  
  const copy = document.createElement('a');
  copy.href = '#'; copy.textContent = 'Copy';
  copy.style.cssText = 'color:#fecaca;text-decoration:underline;cursor:pointer;font-size:11px;';
  copy.onclick = async (e) => {
    e.preventDefault();
    const txt = body.textContent || '';
    try { await navigator.clipboard.writeText(txt); } catch {}
  };
  
  const downloadLog = document.createElement('a');
  downloadLog.href = '#'; downloadLog.textContent = 'Download Log';
  downloadLog.style.cssText = 'color:#fecaca;text-decoration:underline;cursor:pointer;font-size:11px;font-weight:600;';
  downloadLog.onclick = async (e) => {
    e.preventDefault();
    await downloadErrorReport();
  };
  
  actions.appendChild(clear); 
  actions.appendChild(copy); 
  actions.appendChild(downloadLog);
  el.appendChild(title); 
  el.appendChild(body); 
  el.appendChild(actions);
  container.appendChild(el);
  _overlay = el;
  return el;
}

function formatStackTrace(stack: string): string {
  // Clean up and format stack trace for better readability
  return stack
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Highlight the actual error location vs framework code
      if (line.includes('wildfire-rts') || line.includes('src/')) {
        return `→ ${line}`;
      }
      return `  ${line}`;
    })
    .join('\n');
}

function sanitizeUserAgent(ua: string): string {
  // Mask potentially sensitive info in user agent while keeping useful browser/OS info
  return ua
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_MASKED]') // IP addresses
    .replace(/;\s*U;/g, '; [LOCALE];') // Some locale info
    .substring(0, 200); // Limit length
}

async function downloadErrorReport(): Promise<void> {
  try {
    const logger = getLogger();
    const logHistory = logger.getLogHistory();
    
    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        userAgent: sanitizeUserAgent(navigator.userAgent),
        url: window.location.href,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp_unix: Date.now()
      },
      errors: _errorHistory,
      recentLogs: logHistory.slice(-50), // Last 50 log entries
      systemInfo: {
        platform: navigator.platform,
        language: navigator.language,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine
      }
    };

    const reportJson = JSON.stringify(report, null, 2);
    const blob = new Blob([reportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `wildfire-rts-error-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    logger.info('Error report downloaded', { 
      errorCount: _errorHistory.length,
      logCount: logHistory.length 
    }, 'errorOverlay');
  } catch (err) {
    console.error('Failed to download error report:', err);
  }
}

function recordError(type: 'error' | 'unhandledrejection', message: string, stack?: string, location?: string): void {
  const report: ErrorReport = {
    timestamp: new Date().toISOString(),
    message,
    stack,
    location,
    userAgent: sanitizeUserAgent(navigator.userAgent),
    url: window.location.href,
    type
  };
  
  _errorHistory.push(report);
  
  // Keep only last 20 errors to prevent memory issues
  if (_errorHistory.length > 20) {
    _errorHistory = _errorHistory.slice(-20);
  }
  
  // Log to the logging system as well
  const logger = getLogger();
  logger.error(`Runtime ${type}`, {
    message,
    stack: stack?.substring(0, 500), // Truncate very long stacks
    location,
    url: window.location.href
  }, 'errorOverlay');
}

export function showErrorOverlay(container: HTMLElement, message: string, stack?: string, location?: string) {
  const el = ensureOverlay(container);
  const body = el.querySelector('.err-body') as HTMLDivElement;
  
  // Format the error display with clear sections
  let displayText = `ERROR: ${message}`;
  
  if (location) {
    displayText += `\nLOCATION: ${location}`;
  }
  
  if (stack) {
    displayText += `\n\nSTACK TRACE:\n${formatStackTrace(stack)}`;
  }
  
  displayText += `\n\nTIME: ${new Date().toISOString()}`;
  displayText += `\nURL: ${window.location.href}`;
  
  body.textContent = displayText;
  el.style.display = 'block';
}

export function installGlobalErrorOverlay(container: HTMLElement) {
  ensureOverlay(container);
  window.addEventListener('error', (e) => {
    const msg = e.message || 'Unknown error occurred';
    const location = `${e.filename || 'unknown'}:${e.lineno || 0}:${e.colno || 0}`;
    const st = (e.error && (e.error as any).stack) ? String((e.error as any).stack) : undefined;
    
    console.error('[runtime error]', e.error || e);
    recordError('error', msg, st, location);
    showErrorOverlay(container, msg, st, location);
  });
  
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason: any = (e as any).reason;
    const msg = 'Unhandled Promise Rejection: ' + (reason && reason.message ? reason.message : String(reason));
    const st = reason && reason.stack ? String(reason.stack) : undefined;
    
    console.error('[unhandled rejection]', reason);
    recordError('unhandledrejection', msg, st);
    showErrorOverlay(container, msg, st);
  });
}

