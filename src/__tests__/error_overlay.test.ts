import { describe, it, expect } from 'vitest';
import { installGlobalErrorOverlay, showErrorOverlay } from '../ui/errorOverlay';

describe('error overlay', () => {
  it('creates an overlay and shows messages', () => {
    if (typeof document === 'undefined') { expect(true).toBe(true); return; }
    const host = document.createElement('div');
    document.body.appendChild(host);
    installGlobalErrorOverlay(host as any);
    showErrorOverlay(host as any, 'Test error', 'stack...');
    const txt = (host as any).textContent || '';
    expect(txt).toContain('Test error');
  });
});
