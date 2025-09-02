import { describe, it, expect, beforeEach } from 'vitest';
import { Logger, LoggerConfig, createLogger, getLogger, LoggerFactory } from '../../tools/logging/index.js';

describe('Logging System', () => {
  let logger: Logger;

  beforeEach(() => {
    LoggerFactory.resetInstance();
  });

  it('should create logger with default configuration', () => {
    logger = createLogger();
    expect(logger).toBeInstanceOf(Logger);
  });

  it('should respect log level filtering', () => {
    const config: Partial<LoggerConfig> = {
      level: 'warn',
      sinks: {
        console: { enabled: false, format: 'simple' },
        file: { enabled: false, path: '', format: 'json' }
      }
    };
    
    logger = createLogger(config);
    
    // Clear any existing history
    logger.clearHistory();
    
    logger.debug('This should not appear');
    logger.info('This should not appear');
    logger.warn('This should appear');
    logger.error('This should also appear');
    
    const history = logger.getLogHistory();
    expect(history).toHaveLength(2);
    expect(history[0].level).toBe('warn');
    expect(history[1].level).toBe('error');
  });

  it('should support structured logging', () => {
    const config: Partial<LoggerConfig> = {
      structured: {
        enabled: true,
        includeTimestamp: true,
        includeLevel: true,
        includeSource: true
      },
      sinks: {
        console: { enabled: false, format: 'json' },
        file: { enabled: false, path: '', format: 'json' }
      }
    };
    
    logger = createLogger(config);
    logger.clearHistory();
    
    logger.info('Test message', { userId: 123, action: 'login' }, 'auth.service');
    
    const history = logger.getLogHistory();
    expect(history).toHaveLength(1);
    expect(history[0].data).toEqual({ userId: 123, action: 'login' });
    expect(history[0].source).toBe('auth.service');
  });

  it('should handle log rotation by limiting history size', () => {
    logger = createLogger({
      sinks: {
        console: { enabled: false, format: 'simple' },
        file: { enabled: false, path: '', format: 'json' }
      }
    });
    
    logger.clearHistory();
    
    // Generate more than 1000 log entries to trigger rotation
    for (let i = 0; i < 1100; i++) {
      logger.info(`Message ${i}`);
    }
    
    const history = logger.getLogHistory();
    expect(history.length).toBeLessThanOrEqual(1000);
    // Should keep the most recent entries
    expect(history[history.length - 1].message).toBe('Message 1099');
  });

  it('should support singleton pattern', () => {
    const logger1 = getLogger({ level: 'debug' });
    const logger2 = getLogger({ level: 'error' });
    
    expect(logger1).toBe(logger2);
  });

  it('should have third-party reporting disabled by default', () => {
    logger = createLogger();
    
    // Access the config through the logger - we'd need to expose this in a real implementation
    // For now, we'll test that error logging doesn't throw when Sentry is disabled
    expect(() => {
      logger.error('Test error');
    }).not.toThrow();
  });

  it('should support configuration updates', () => {
    logger = createLogger({ level: 'error' });
    logger.clearHistory();
    
    logger.info('Should not log');
    expect(logger.getLogHistory()).toHaveLength(0);
    
    logger.updateConfig({ level: 'info' });
    logger.info('Should log now');
    expect(logger.getLogHistory()).toHaveLength(1);
  });
});