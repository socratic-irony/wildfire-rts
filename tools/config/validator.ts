import { AppConfig, ConfigValidationError } from './types';

/**
 * Validate configuration against the schema
 */
export function validateConfig(config: any): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  function validateSection(obj: any, path: string, schema: any): void {
    if (typeof obj !== 'object' || obj === null) {
      errors.push({ path, message: 'Expected object', value: obj });
      return;
    }

    // Check required properties and types
    for (const [key, value] of Object.entries(obj)) {
      const propPath = path ? `${path}.${key}` : key;
      const schemaType = getExpectedType(path, key);
      
      if (schemaType && !isValidType(value, schemaType)) {
        errors.push({ 
          path: propPath, 
          message: `Expected ${schemaType}, got ${typeof value}`, 
          value 
        });
      }

      if (key === 'verbosity' && path === 'logging') {
        const validValues = ['silent', 'error', 'warn', 'info', 'debug', 'verbose'];
        if (!validValues.includes(value as string)) {
          errors.push({
            path: propPath,
            message: `Invalid verbosity level. Must be one of: ${validValues.join(', ')}`,
            value
          });
        }
      }

      if (key === 'maxPixelRatio' && path === 'rendering') {
        if (typeof value === 'number' && (value < 1 || value > 3)) {
          errors.push({
            path: propPath,
            message: 'maxPixelRatio must be between 1 and 3',
            value
          });
        }
      }
    }
  }

  // Validate each top-level section
  const expectedSections = ['logging', 'debug', 'rendering', 'features'];
  for (const section of expectedSections) {
    if (config[section]) {
      validateSection(config[section], section, null);
    }
  }

  return errors;
}

function getExpectedType(section: string, key: string): string | null {
  const typeMap: Record<string, Record<string, string>> = {
    logging: {
      verbosity: 'string',
      enableConsoleTimestamps: 'boolean',
      enablePerformanceLogs: 'boolean'
    },
    debug: {
      showStats: 'boolean',
      enableGridOverlay: 'boolean',
      enableWireframe: 'boolean'
    },
    rendering: {
      antialias: 'boolean',
      shadows: 'boolean',
      maxPixelRatio: 'number'
    },
    features: {
      enableExperimentalFeatures: 'boolean'
    }
  };

  return typeMap[section]?.[key] || null;
}

function isValidType(value: any, expectedType: string): boolean {
  return typeof value === expectedType;
}