import { Logger, LoggerConfig } from './logger.js';

// Default configuration
const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  enableConsole: true,
  enableFileLogging: false,
  fileRotation: {
    enabled: false,
    maxFiles: 5,
    maxSizeMB: 10,
  },
  sinks: {
    console: {
      enabled: true,
      format: 'simple',
    },
    file: {
      enabled: false,
      path: 'logs/app.log',
      format: 'json',
    },
  },
  thirdParty: {
    sentry: {
      enabled: false,
      dsn: '',
      environment: 'development',
    },
  },
  structured: {
    enabled: true,
    includeTimestamp: true,
    includeLevel: true,
    includeSource: false,
  },
};

export class LoggerFactory {
  private static instance: Logger | null = null;

  /**
   * Create a logger instance with configuration
   */
  static create(config?: Partial<LoggerConfig>): Logger {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    return new Logger(finalConfig);
  }

  /**
   * Create a logger from JSON configuration file
   * In a real browser environment, this would fetch the config
   * For now, we'll accept config as parameter
   */
  static createFromConfig(configData: any): Logger {
    const config = { ...DEFAULT_CONFIG, ...configData };
    return new Logger(config);
  }

  /**
   * Get or create a singleton logger instance
   */
  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!LoggerFactory.instance) {
      LoggerFactory.instance = LoggerFactory.create(config);
    }
    return LoggerFactory.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    LoggerFactory.instance = null;
  }
}

// Convenience functions for direct usage
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return LoggerFactory.create(config);
}

export function getLogger(config?: Partial<LoggerConfig>): Logger {
  return LoggerFactory.getInstance(config);
}