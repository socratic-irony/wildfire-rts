import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigurableLogger } from '../../tools/logger';
import { LoggingConfig } from '../../tools/config/types';

// Mock console methods using vi
const mockConsole = {
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

// Set up console mocks
console.log = mockConsole.log;
console.info = mockConsole.info;
console.warn = mockConsole.warn;
console.error = mockConsole.error;

describe('configurable logger', () => {
  beforeEach(() => {
    // Clear all mock calls before each test
    mockConsole.log.mockClear();
    mockConsole.info.mockClear();
    mockConsole.warn.mockClear();
    mockConsole.error.mockClear();
  });

  it('respects verbosity levels', () => {
    const config: LoggingConfig = {
      verbosity: 'warn',
      enableConsoleTimestamps: false,
      enablePerformanceLogs: false
    };
    
    const logger = new ConfigurableLogger(config);
    
    logger.debug('debug message'); // Should not log (below warn)
    logger.info('info message');   // Should not log (below warn)
    logger.warn('warn message');   // Should log
    logger.error('error message'); // Should log
    
    expect(mockConsole.log).not.toHaveBeenCalled();
    expect(mockConsole.info).not.toHaveBeenCalled();
    expect(mockConsole.warn).toHaveBeenCalledTimes(1);
    expect(mockConsole.error).toHaveBeenCalledTimes(1);
    expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] warn message');
    expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] error message');
  });

  it('adds timestamps when enabled', () => {
    const config: LoggingConfig = {
      verbosity: 'info',
      enableConsoleTimestamps: true,
      enablePerformanceLogs: false
    };
    
    const logger = new ConfigurableLogger(config);
    logger.info('test message');
    
    expect(mockConsole.info).toHaveBeenCalledTimes(1);
    const logMessage = mockConsole.info.mock.calls[0][0];
    // Should contain ISO timestamp format
    expect(logMessage).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] test message$/);
  });

  it('logs performance metrics when enabled', () => {
    const config: LoggingConfig = {
      verbosity: 'info',
      enableConsoleTimestamps: false,
      enablePerformanceLogs: true
    };
    
    const logger = new ConfigurableLogger(config);
    logger.performance('test operation', 42.5);
    
    expect(mockConsole.log).toHaveBeenCalledTimes(1);
    expect(mockConsole.log).toHaveBeenCalledWith('[INFO] Performance: test operation = 42.50ms');
  });

  it('skips performance logging when disabled', () => {
    const config: LoggingConfig = {
      verbosity: 'info',
      enableConsoleTimestamps: false,
      enablePerformanceLogs: false
    };
    
    const logger = new ConfigurableLogger(config);
    logger.performance('test operation', 42.5);
    
    expect(mockConsole.log).not.toHaveBeenCalled();
  });

  it('times function execution when performance logging enabled', () => {
    const config: LoggingConfig = {
      verbosity: 'info',
      enableConsoleTimestamps: false,
      enablePerformanceLogs: true
    };
    
    const logger = new ConfigurableLogger(config);
    
    const result = logger.timeFunction('test function', () => {
      // Simulate some work
      return 42;
    });
    
    expect(result).toBe(42);
    expect(mockConsole.log).toHaveBeenCalledTimes(1);
    const logMessage = mockConsole.log.mock.calls[0][0];
    expect(logMessage).toContain('[INFO] Performance: test function =');
  });

  it('skips timing when performance logging disabled', () => {
    const config: LoggingConfig = {
      verbosity: 'info',
      enableConsoleTimestamps: false,
      enablePerformanceLogs: false
    };
    
    const logger = new ConfigurableLogger(config);
    
    const result = logger.timeFunction('test function', () => {
      return 42;
    });
    
    expect(result).toBe(42);
    expect(mockConsole.log).not.toHaveBeenCalled();
  });

  it('updates configuration dynamically', () => {
    let config: LoggingConfig = {
      verbosity: 'error',
      enableConsoleTimestamps: false,
      enablePerformanceLogs: false
    };
    
    const logger = new ConfigurableLogger(config);
    logger.warn('first message'); // Should not log
    
    // Update config to allow warnings
    config = { ...config, verbosity: 'warn' };
    logger.updateConfig(config);
    logger.warn('second message'); // Should log
    
    expect(mockConsole.warn).toHaveBeenCalledTimes(1);
    expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] second message');
  });
});
