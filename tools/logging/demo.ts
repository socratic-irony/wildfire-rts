import { createLogger, getLogger } from '../index.js';

// Demo configuration with multiple sinks and structured logging
const demoConfig = {
  level: 'debug' as const,
  structured: {
    enabled: true,
    includeTimestamp: true,
    includeLevel: true,
    includeSource: true,
  },
  sinks: {
    console: {
      enabled: true,
      format: 'json' as const,
    },
    file: {
      enabled: true, // This will output to console with [FILE] prefix in browser
      path: 'logs/demo.log',
      format: 'json' as const,
    },
  },
  thirdParty: {
    sentry: {
      enabled: false, // Disabled by default as per requirements
      dsn: '',
      environment: 'demo',
    },
  },
};

/**
 * Demonstrate logging levels and rotation
 */
export function runLoggingDemo(): void {
  console.log('=== Logging System Demo ===\n');

  // Create logger with demo configuration
  const logger = createLogger(demoConfig);

  console.log('1. Testing different log levels:');
  logger.debug('Debug message - detailed information for developers');
  logger.info('Info message - general information about application flow');
  logger.warn('Warning message - something unexpected but not critical');
  logger.error('Error message - something went wrong');

  console.log('\n2. Testing structured logging with data:');
  logger.info('User logged in', {
    userId: 'user-123',
    sessionId: 'session-456',
    ipAddress: '192.168.1.1',
  }, 'auth.service');

  logger.warn('API rate limit approaching', {
    endpoint: '/api/users',
    currentRequests: 95,
    limit: 100,
    resetTime: new Date(Date.now() + 60000).toISOString(),
  }, 'rate.limiter');

  logger.error('Database connection failed', {
    database: 'primary',
    error: 'Connection timeout',
    retryAttempt: 3,
    maxRetries: 5,
  }, 'db.connector');

  console.log('\n3. Testing log level filtering:');
  const errorOnlyLogger = createLogger({
    level: 'error',
    sinks: {
      console: { enabled: true, format: 'simple' },
      file: { enabled: false, path: '', format: 'json' }
    }
  });

  console.log('Logger configured for ERROR level only:');
  errorOnlyLogger.debug('This debug message should not appear');
  errorOnlyLogger.info('This info message should not appear');
  errorOnlyLogger.warn('This warning should not appear');
  errorOnlyLogger.error('This error message should appear');

  console.log('\n4. Testing log rotation simulation:');
  logger.clearHistory();
  console.log('Generating 1100 log entries to demonstrate rotation...');
  
  for (let i = 0; i < 1100; i++) {
    logger.info(`Log entry ${i}`, { iteration: i });
  }
  
  const history = logger.getLogHistory();
  console.log(`History contains ${history.length} entries (should be ≤ 1000 due to rotation)`);
  console.log(`First entry: "${history[0].message}"`);
  console.log(`Last entry: "${history[history.length - 1].message}"`);

  console.log('\n5. Testing singleton pattern:');
  const logger1 = getLogger();
  const logger2 = getLogger();
  console.log(`Singleton test: logger1 === logger2: ${logger1 === logger2}`);

  console.log('\n6. Feature flags demonstration:');
  console.log('Third-party reporting (Sentry) is DISABLED by default');
  console.log('File logging is available but uses console in browser environment');
  
  // Demonstrate configuration update
  console.log('\n7. Dynamic configuration update:');
  const dynamicLogger = createLogger({ level: 'warn' });
  dynamicLogger.clearHistory();
  
  dynamicLogger.info('This should not log (level: warn)');
  console.log(`Log count before update: ${dynamicLogger.getLogHistory().length}`);
  
  dynamicLogger.updateConfig({ level: 'info' });
  dynamicLogger.info('This should log now (level updated to info)');
  console.log(`Log count after update: ${dynamicLogger.getLogHistory().length}`);

  console.log('\n=== Demo Complete ===');
}

// Auto-run demo if this file is executed directly
if (typeof window !== 'undefined' && (window as any).runLoggingDemo === undefined) {
  (window as any).runLoggingDemo = runLoggingDemo;
  console.log('Logging demo loaded. Run runLoggingDemo() to see it in action.');
}