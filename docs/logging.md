# Logging System

This document describes the logging and error reporting wrapper for the wildfire-rts project.

## Overview

The logging system provides a standardized way to capture, format, and route log messages throughout the application. It supports multiple log levels, structured logging, configurable sinks, and optional third-party integrations.

## Features

- **Log Levels**: Debug, Info, Warn, Error with configurable filtering
- **Structured Logging**: JSON-formatted logs with metadata
- **Multiple Sinks**: Console and file output (file uses console in browser environment)
- **Feature Flags**: Third-party reporting (Sentry) disabled by default
- **Log Rotation**: Automatic history management to prevent memory leaks
- **Configuration**: JSON-based configuration with runtime updates
- **Singleton Pattern**: Global logger instance available

## Quick Start

### Basic Usage

```typescript
import { createLogger } from './tools/logging/index.js';

const logger = createLogger();

logger.debug('Debug message');
logger.info('Application started');
logger.warn('Non-critical warning');
logger.error('Something went wrong');
```

### Structured Logging

```typescript
logger.info('User action', {
  userId: 'user-123',
  action: 'login',
  timestamp: Date.now()
}, 'auth.service');
```

### Configuration

```typescript
import { createLogger } from './tools/logging/index.js';

const logger = createLogger({
  level: 'warn',
  structured: {
    enabled: true,
    includeTimestamp: true,
    includeLevel: true,
    includeSource: true
  },
  sinks: {
    console: { enabled: true, format: 'json' },
    file: { enabled: false, path: 'logs/app.log', format: 'json' }
  },
  thirdParty: {
    sentry: { enabled: false, dsn: '', environment: 'production' }
  }
});
```

## Configuration File

The logging system can be configured via `config/logging.json`:

```json
{
  "level": "info",
  "enableConsole": true,
  "enableFileLogging": false,
  "structured": {
    "enabled": true,
    "includeTimestamp": true,
    "includeLevel": true,
    "includeSource": false
  },
  "thirdParty": {
    "sentry": {
      "enabled": false,
      "dsn": "",
      "environment": "development"
    }
  }
}
```

## Log Levels

- **Debug**: Detailed information for debugging (level 0)
- **Info**: General application flow information (level 1)  
- **Warn**: Warning messages for unexpected but non-critical events (level 2)
- **Error**: Error conditions that should be investigated (level 3)

Only logs at or above the configured level will be processed.

## Sinks

### Console Sink
Outputs logs to browser console using appropriate console methods (debug, info, warn, error).

### File Sink
In browser environment, outputs to console with `[FILE]` prefix. In Node.js environment, would write to actual files.

### Third-Party Reporting (Sentry)
Optional integration with Sentry for error reporting. **Disabled by default** as per requirements.

## Log Rotation

The system automatically manages memory usage by:
- Keeping a maximum of 1000 log entries in memory
- When limit is reached, keeping only the most recent 500 entries
- Clearing old entries to prevent memory leaks

## API Reference

### Logger Class

```typescript
class Logger {
  debug(message: string, data?: Record<string, any>, source?: string): void
  info(message: string, data?: Record<string, any>, source?: string): void
  warn(message: string, data?: Record<string, any>, source?: string): void
  error(message: string, data?: Record<string, any>, source?: string): void
  
  getLogHistory(): LogEntry[]
  clearHistory(): void
  updateConfig(config: Partial<LoggerConfig>): void
}
```

### Factory Functions

```typescript
// Create new logger instance
createLogger(config?: Partial<LoggerConfig>): Logger

// Get singleton instance
getLogger(config?: Partial<LoggerConfig>): Logger

// Create from configuration data
LoggerFactory.createFromConfig(configData: any): Logger
```

## Demo and Testing

Run the demo to see all features in action:

```typescript
import { runLoggingDemo } from './tools/logging/demo.js';
runLoggingDemo();
```

Run tests:

```bash
npm test
```

The test suite covers:
- Log level filtering
- Structured logging
- Log rotation
- Configuration updates
- Singleton pattern
- Feature flag verification

## Feature Flags

### Third-Party Reporting
- **Default**: Disabled
- **Configuration**: `config.thirdParty.sentry.enabled`
- **Purpose**: Optional integration with external error reporting services
- **Security**: DSN and environment configurable, no credentials in code

### File Logging
- **Default**: Disabled
- **Configuration**: `config.sinks.file.enabled`
- **Purpose**: Persistent log storage (console-based in browser environment)

## Integration Guidelines

### Adding to Existing Code
```typescript
// Import at top of module
import { getLogger } from './tools/logging/index.js';

// Get logger instance
const logger = getLogger();

// Use throughout module
logger.info('Module initialized');
```

### Error Handling Integration
```typescript
try {
  // risky operation
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    stack: error.stack,
    context: 'user-action'
  }, 'module.name');
  throw error; // re-throw if needed
}
```

## Security Considerations

- No sensitive data logged by default
- Third-party reporting disabled by default
- DSN and credentials configurable, not hardcoded
- Structured logging allows filtering of sensitive fields
- Log rotation prevents unbounded memory growth

## Performance

- Minimal overhead when log level filtering prevents processing
- In-memory log history bounded to prevent memory leaks
- Console output uses native browser methods
- No synchronous file I/O in browser environment