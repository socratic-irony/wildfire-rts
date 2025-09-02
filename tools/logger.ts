import { LoggingConfig } from '../config/types';

type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  verbose: 5
};

/**
 * Simple logger that respects configuration-driven verbosity levels
 * This demonstrates feature flag usage in a non-critical path
 */
export class ConfigurableLogger {
  private config: LoggingConfig;

  constructor(config: LoggingConfig) {
    this.config = config;
  }

  updateConfig(config: LoggingConfig): void {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.config.verbosity];
  }

  private formatMessage(level: LogLevel, message: string): string {
    let formatted = `[${level.toUpperCase()}] ${message}`;
    
    if (this.config.enableConsoleTimestamps) {
      const timestamp = new Date().toISOString();
      formatted = `${timestamp} ${formatted}`;
    }
    
    return formatted;
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  verbose(message: string, ...args: any[]): void {
    if (this.shouldLog('verbose')) {
      console.log(this.formatMessage('verbose', message), ...args);
    }
  }

  /**
   * Log performance metrics if enabled by feature flag
   */
  performance(label: string, value: number, unit: string = 'ms'): void {
    if (this.config.enablePerformanceLogs && this.shouldLog('info')) {
      const message = `Performance: ${label} = ${value.toFixed(2)}${unit}`;
      console.log(this.formatMessage('info', message));
    }
  }

  /**
   * Time a function execution and log if performance logging is enabled
   */
  timeFunction<T>(label: string, fn: () => T): T {
    if (!this.config.enablePerformanceLogs) {
      return fn();
    }

    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    this.performance(label, duration);
    return result;
  }

  /**
   * Time an async function execution and log if performance logging is enabled
   */
  async timeAsyncFunction<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.config.enablePerformanceLogs) {
      return await fn();
    }

    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    this.performance(label, duration);
    return result;
  }
}