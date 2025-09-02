export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  data?: Record<string, any>;
  source?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFileLogging: boolean;
  fileRotation: {
    enabled: boolean;
    maxFiles: number;
    maxSizeMB: number;
  };
  sinks: {
    console: {
      enabled: boolean;
      format: 'simple' | 'json';
    };
    file: {
      enabled: boolean;
      path: string;
      format: 'simple' | 'json';
    };
  };
  thirdParty: {
    sentry: {
      enabled: boolean;
      dsn: string;
      environment: string;
    };
  };
  structured: {
    enabled: boolean;
    includeTimestamp: boolean;
    includeLevel: boolean;
    includeSource: boolean;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private config: LoggerConfig;
  private logHistory: LogEntry[] = [];

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(entry: LogEntry): string {
    if (this.config.structured.enabled) {
      const formatted: Record<string, any> = { message: entry.message };
      
      if (this.config.structured.includeTimestamp) {
        formatted.timestamp = new Date(entry.timestamp).toISOString();
      }
      
      if (this.config.structured.includeLevel) {
        formatted.level = entry.level;
      }
      
      if (this.config.structured.includeSource && entry.source) {
        formatted.source = entry.source;
      }
      
      if (entry.data) {
        formatted.data = entry.data;
      }
      
      return JSON.stringify(formatted);
    } else {
      const timestamp = new Date(entry.timestamp).toISOString();
      const level = entry.level.toUpperCase();
      return `[${timestamp}] ${level}: ${entry.message}${entry.data ? ' ' + JSON.stringify(entry.data) : ''}`;
    }
  }

  private writeToSinks(entry: LogEntry): void {
    const formattedMessage = this.formatMessage(entry);
    
    // Console sink
    if (this.config.sinks.console.enabled) {
      switch (entry.level) {
        case 'debug':
          console.debug(formattedMessage);
          break;
        case 'info':
          console.info(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        case 'error':
          console.error(formattedMessage);
          break;
      }
    }

    // File sink would go here in a real implementation
    // For now, we'll just store in memory for demo purposes
    if (this.config.sinks.file.enabled) {
      // In a real implementation, this would write to file
      // For browser environment, we'll just log to console with file prefix
      console.log(`[FILE] ${formattedMessage}`);
    }

    // Third-party reporting (Sentry)
    if (this.config.thirdParty.sentry.enabled && entry.level === 'error') {
      // In a real implementation, this would send to Sentry
      console.log(`[SENTRY] ${formattedMessage}`);
    }
  }

  private log(level: LogLevel, message: string, data?: Record<string, any>, source?: string): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      data,
      source,
    };

    this.logHistory.push(entry);
    this.writeToSinks(entry);

    // Rotate log history if it gets too long
    if (this.logHistory.length > 1000) {
      this.logHistory = this.logHistory.slice(-500);
    }
  }

  debug(message: string, data?: Record<string, any>, source?: string): void {
    this.log('debug', message, data, source);
  }

  info(message: string, data?: Record<string, any>, source?: string): void {
    this.log('info', message, data, source);
  }

  warn(message: string, data?: Record<string, any>, source?: string): void {
    this.log('warn', message, data, source);
  }

  error(message: string, data?: Record<string, any>, source?: string): void {
    this.log('error', message, data, source);
  }

  getLogHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  clearHistory(): void {
    this.logHistory = [];
  }

  updateConfig(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}