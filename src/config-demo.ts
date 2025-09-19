import { loadConfig } from '../tools/config';
import { ConfigurableLogger } from '../tools/logger';

/**
 * Configuration demo showing feature flag usage in a non-critical path
 * This can be called to demonstrate the configuration system
 */
async function demonstrateConfiguration(): Promise<void> {
  console.log('=== Configuration System Demo ===');
  
  try {
    // Load configuration with environment overrides
    const { config, errors } = await loadConfig({
      allowEnvironmentOverrides: true,
      throwOnValidationErrors: false
    });
    
    // Report any validation errors (but don't throw)
    if (errors.length > 0) {
      console.warn('Configuration validation errors found:');
      errors.forEach((error: any) => {
        console.warn(`  ${error.path}: ${error.message}`);
      });
    }
    
    console.log('Loaded configuration:', JSON.stringify(config, null, 2));
    
    // Create logger with loaded configuration
    const logger = new ConfigurableLogger(config.logging);
    
    // Demonstrate logging at different levels
    logger.info('Configuration system initialized successfully');
    logger.debug('Debug logging demonstration');
    logger.verbose('Verbose logging demonstration');
    
    // Demonstrate performance logging feature flag
    logger.performance('config-loading', 25.3);
    
    // Demonstrate timing functions
    const result = logger.timeFunction('expensive-operation', () => {
      // Simulate some work
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += Math.sqrt(i);
      }
      return sum;
    });
    
    logger.info(`Computed result: ${result.toFixed(2)}`);
    
    // Demonstrate feature flags
    if (config.features.enableExperimentalFeatures) {
      logger.warn('Experimental features are ENABLED - this may affect stability');
    } else {
      logger.info('Experimental features are disabled (recommended for production)');
    }
    
    // Demonstrate debug feature flags
    if (config.debug.enableGridOverlay) {
      logger.debug('Grid overlay would be enabled by default');
    }
    
    if (config.debug.enableWireframe) {
      logger.debug('Wireframe rendering would be enabled');
    }
    
    console.log('=== Demo Complete ===');
    
  } catch (error) {
    console.error('Configuration system error:', error);
  }
}

// Export for testing or manual invocation
if (typeof window !== 'undefined') {
  // Browser environment - expose on window for manual testing
  (window as any).demonstrateConfiguration = demonstrateConfiguration;
}