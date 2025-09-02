import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../tools/config/validator';

describe('configuration validator', () => {
  it('validates a correct configuration', () => {
    const validConfig = {
      logging: {
        verbosity: 'info',
        enableConsoleTimestamps: false,
        enablePerformanceLogs: false
      },
      debug: {
        showStats: true,
        enableGridOverlay: false,
        enableWireframe: false
      },
      rendering: {
        antialias: true,
        shadows: true,
        maxPixelRatio: 2
      },
      features: {
        enableExperimentalFeatures: false
      }
    };

    const errors = validateConfig(validConfig);
    expect(errors).toHaveLength(0);
  });

  it('detects invalid verbosity levels', () => {
    const invalidConfig = {
      logging: {
        verbosity: 'invalid-level',
        enableConsoleTimestamps: false,
        enablePerformanceLogs: false
      }
    };

    const errors = validateConfig(invalidConfig);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('logging.verbosity');
    expect(errors[0].message).toContain('Invalid verbosity level');
  });

  it('detects invalid types', () => {
    const invalidConfig = {
      logging: {
        verbosity: 'info',
        enableConsoleTimestamps: 'not-a-boolean',
        enablePerformanceLogs: false
      },
      rendering: {
        antialias: true,
        shadows: true,
        maxPixelRatio: 'not-a-number'
      }
    };

    const errors = validateConfig(invalidConfig);
    expect(errors.length).toBeGreaterThan(0);
    
    const timestampError = errors.find(e => e.path === 'logging.enableConsoleTimestamps');
    expect(timestampError?.message).toContain('Expected boolean');

    const pixelRatioError = errors.find(e => e.path === 'rendering.maxPixelRatio');
    expect(pixelRatioError?.message).toContain('Expected number');
  });

  it('validates maxPixelRatio range', () => {
    const invalidConfig = {
      rendering: {
        antialias: true,
        shadows: true,
        maxPixelRatio: 5 // Out of valid range (1-3)
      }
    };

    const errors = validateConfig(invalidConfig);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('rendering.maxPixelRatio');
    expect(errors[0].message).toContain('must be between 1 and 3');
  });

  it('validates all verbosity levels', () => {
    const validLevels = ['silent', 'error', 'warn', 'info', 'debug', 'verbose'];
    
    for (const level of validLevels) {
      const config = {
        logging: { verbosity: level }
      };
      const errors = validateConfig(config);
      const verbosityErrors = errors.filter(e => e.path === 'logging.verbosity');
      expect(verbosityErrors).toHaveLength(0);
    }
  });
});