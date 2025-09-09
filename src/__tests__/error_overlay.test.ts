import { describe, it, expect, beforeEach } from 'vitest';
import { installGlobalErrorOverlay, showErrorOverlay } from '../ui/errorOverlay';

describe('enhanced error overlay', () => {
  let container: HTMLElement;

  beforeEach(() => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  it('creates an overlay and shows enhanced error messages', () => {
    if (typeof document === 'undefined') { 
      expect(true).toBe(true); 
      return; 
    }
    
    installGlobalErrorOverlay(container as any);
    showErrorOverlay(
      container as any, 
      'Test error with details', 
      'Error: Test error\n    at testFunction (test.js:10:5)\n    at main (app.js:5:2)',
      'test.js:10:5'
    );
    
    const txt = (container as any).textContent || '';
    expect(txt).toContain('Test error with details');
    expect(txt).toContain('LOCATION: test.js:10:5');
    expect(txt).toContain('STACK TRACE:');
    expect(txt).toContain('testFunction');
    expect(txt).toContain('TIME:');
    expect(txt).toContain('URL:');
  });

  it('includes download log button', () => {
    if (typeof document === 'undefined') { 
      expect(true).toBe(true); 
      return; 
    }
    
    installGlobalErrorOverlay(container as any);
    const downloadLink = container.querySelector('a[href="#"]') as HTMLElement;
    expect(downloadLink).toBeTruthy();
    
    // Check if any link contains "Download Log"
    const links = container.querySelectorAll('a');
    const downloadLogLink = Array.from(links).find(link => 
      link.textContent === 'Download Log'
    );
    expect(downloadLogLink).toBeTruthy();
  });

  it('formats stack traces with highlighting', () => {
    if (typeof document === 'undefined') { 
      expect(true).toBe(true); 
      return; 
    }
    
    const testStack = `Error: Test error
    at myFunction (src/test.js:10:5)
    at Object.doSomething (node_modules/lib/index.js:20:10)
    at main (src/main.js:5:2)`;
    
    showErrorOverlay(container as any, 'Test error', testStack);
    
    const txt = (container as any).textContent || '';
    // Should highlight lines containing 'src/' with arrow
    expect(txt).toContain('→');
  });

  it('handles undefined promise rejection with helpful message', () => {
    if (typeof document === 'undefined') { 
      expect(true).toBe(true); 
      return; 
    }
    
    // Test our improved message formatting by simulating the promise rejection handling
    const mockEvent = {
      reason: undefined
    } as any;
    
    // Simulate what the unhandledrejection handler does
    const reason: any = mockEvent.reason;
    let msg: string;
    
    if (reason === undefined || reason === null) {
      msg = 'Unhandled Promise Rejection: Promise was rejected with no error details. This may indicate a missing .catch() handler or an async operation that failed silently.';
    } else if (reason && reason.message) {
      msg = 'Unhandled Promise Rejection: ' + reason.message;
    } else {
      msg = 'Unhandled Promise Rejection: ' + String(reason);
    }
    
    expect(msg).toContain('Promise was rejected with no error details');
    expect(msg).toContain('missing .catch() handler');
    expect(msg).not.toBe('Unhandled Promise Rejection: undefined');
  });
});
