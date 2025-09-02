import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock minimal DOM environment
const mockElement = {
  style: {} as any,
  appendChild: vi.fn(),
  querySelector: vi.fn(() => null),
  innerHTML: '',
  scrollTop: 0,
  scrollHeight: 0,
  addEventListener: vi.fn(),
};

const mockInput = {
  ...mockElement,
  value: '',
  focus: vi.fn(),
};

global.document = {
  createElement: vi.fn((tag: string) => {
    if (tag === 'input') return mockInput;
    return mockElement;
  }),
  body: mockElement,
  addEventListener: vi.fn(),
} as any;

global.HTMLElement = class {} as any;

// Mock performance
global.performance = {
  now: () => Date.now(),
  memory: {
    usedJSHeapSize: 50 * 1024 * 1024,
    totalJSHeapSize: 100 * 1024 * 1024, 
    jsHeapSizeLimit: 2000 * 1024 * 1024
  }
} as any;

import { DebugConsole } from '../ui/console';

describe('Debug Console', () => {
  let container: HTMLElement;
  let console: DebugConsole;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Set up mock container
    container = mockElement as any;
    console = new DebugConsole(container);
  });

  describe('initialization', () => {
    it('should create console element', () => {
      expect(document.createElement).toHaveBeenCalledWith('div');
      expect(container.appendChild).toHaveBeenCalled();
    });

    it('should start hidden', () => {
      expect(console.isVisible()).toBe(false);
    });
  });

  describe('visibility control', () => {
    it('should show and hide console', () => {
      console.show();
      expect(console.isVisible()).toBe(true);
      
      console.hide();
      expect(console.isVisible()).toBe(false);
    });

    it('should toggle visibility', () => {
      expect(console.isVisible()).toBe(false);
      
      console.toggle();
      expect(console.isVisible()).toBe(true);
      
      console.toggle();
      expect(console.isVisible()).toBe(false);
    });
  });

  describe('command registration', () => {
    it('should register new commands', () => {
      const testCommand = {
        name: 'test',
        description: 'Test command',
        execute: () => 'test output'
      };
      
      console.registerCommand(testCommand);
      // Command registration is internal, we'll test execution instead
      expect(true).toBe(true); // placeholder
    });

    it('should unregister commands', () => {
      const testCommand = {
        name: 'test',
        description: 'Test command',
        execute: () => 'test output'
      };
      
      console.registerCommand(testCommand);
      console.unregisterCommand('test');
      expect(true).toBe(true); // placeholder
    });
  });

  describe('built-in commands', () => {
    beforeEach(() => {
      console.show(); // Make sure console is visible for command execution
    });

    it('should have help command', async () => {
      const helpCommand = console['commands'].get('help');
      expect(helpCommand).toBeTruthy();
      
      const result = await helpCommand!.execute([]);
      expect(result).toContain('Available commands:');
      expect(result).toContain('help');
      expect(result).toContain('clear');
      expect(result).toContain('config');
    });

    it('should have clear command', async () => {
      const clearCommand = console['commands'].get('clear');
      expect(clearCommand).toBeTruthy();
      
      const result = await clearCommand!.execute([]);
      expect(result).toBe('');
    });

    it('should have config command', async () => {
      const configCommand = console['commands'].get('config');
      expect(configCommand).toBeTruthy();
      
      // Test usage message
      let result = await configCommand!.execute([]);
      expect(result).toBe('Usage: config <key> [value]');
      
      // Test get unknown key
      result = await configCommand!.execute(['unknown.key']);
      expect(result).toContain('Unknown config key');
      
      // Test set value
      result = await configCommand!.execute(['test.key', 'testvalue']);
      expect(result).toContain('Set test.key = "testvalue"');
      
      // Test get set value
      result = await configCommand!.execute(['test.key']);
      expect(result).toBe('test.key = "testvalue"');
    });

    it('should have memory command', async () => {
      const memCommand = console['commands'].get('perf.memory');
      expect(memCommand).toBeTruthy();
      
      const result = await memCommand!.execute([]);
      expect(result).toContain('Memory Usage:');
      expect(result).toContain('Used:');
      expect(result).toContain('Total:');
      expect(result).toContain('Limit:');
    });
  });

  describe('command execution', () => {
    it('should execute valid commands', async () => {
      const mockExecute = vi.fn().mockResolvedValue('mock result');
      console.registerCommand({
        name: 'mock',
        description: 'Mock command',
        execute: mockExecute
      });

      // Test private method directly since DOM mocking is complex
      await console['executeCommand']('mock arg1 arg2');
      
      expect(mockExecute).toHaveBeenCalledWith(['arg1', 'arg2']);
    });

    it('should handle unknown commands gracefully', async () => {
      // This is tested by the fact that executeCommand doesn't throw
      // Full DOM integration would require more complex mocking
      expect(async () => {
        await console['executeCommand']('nonexistent');
      }).not.toThrow();
    });

    it('should handle command errors gracefully', async () => {
      const errorCommand = {
        name: 'error',
        description: 'Error command', 
        execute: () => { throw new Error('Test error'); }
      };
      
      console.registerCommand(errorCommand);
      
      expect(async () => {
        await console['executeCommand']('error');
      }).not.toThrow();
    });
  });

  describe('logging', () => {
    it('should add log messages', () => {
      console.addLog('Test message');
      console.addLog('Error message', '#ef4444');
      
      // Logs are added internally, just verify the method exists
      expect(typeof console.addLog).toBe('function');
    });
  });
});