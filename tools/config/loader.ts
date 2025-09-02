import { AppConfig, ConfigLoadOptions, ConfigValidationError } from './types';
import { validateConfig } from './validator';

// Import default configuration
import defaultConfig from '../../config/default.json';

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) return target;
  if (target === null || target === undefined) return source;
  if (typeof source !== 'object') return source;
  if (typeof target !== 'object') return source;

  const result = { ...target };
  
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Load configuration from environment variables
 * Environment variables should follow the pattern: WF_<SECTION>_<KEY>
 * Example: WF_LOGGING_VERBOSITY=debug
 */
function loadFromEnvironment(): Partial<AppConfig> {
  const config: any = {};
  const envVars = typeof process !== 'undefined' ? process.env : {};
  
  for (const [key, value] of Object.entries(envVars)) {
    if (!key.startsWith('WF_') || !value) continue;
    
    const parts = key.substring(3).toLowerCase().split('_');
    if (parts.length !== 2) continue;
    
    const [section, prop] = parts;
    if (!config[section]) config[section] = {};
    
    // Convert string values to appropriate types
    let convertedValue: any = value;
    if (value === 'true') convertedValue = true;
    else if (value === 'false') convertedValue = false;
    else if (value && !isNaN(Number(value))) convertedValue = Number(value);
    
    config[section][prop] = convertedValue;
  }
  
  return config;
}

/**
 * Attempt to load local configuration file
 */
async function loadLocalConfig(): Promise<Partial<AppConfig>> {
  try {
    // In a real implementation, we'd use fetch or fs to load the file
    // For now, return empty config since we can't dynamically import in this context
    return {};
  } catch (error) {
    // Local config is optional, so we don't throw errors
    return {};
  }
}

/**
 * Load and merge configuration from multiple sources
 */
export async function loadConfig(options: ConfigLoadOptions = {}): Promise<{ 
  config: AppConfig; 
  errors: ConfigValidationError[] 
}> {
  const { 
    allowEnvironmentOverrides = true, 
    throwOnValidationErrors = false 
  } = options;

  // Start with default configuration
  let config = { ...defaultConfig };

  // Load and merge local config if it exists
  const localConfig = await loadLocalConfig();
  config = deepMerge(config, localConfig);

  // Load and merge environment overrides
  if (allowEnvironmentOverrides) {
    const envConfig = loadFromEnvironment();
    config = deepMerge(config, envConfig);
  }

  // Validate the final configuration
  const errors = validateConfig(config);
  
  if (throwOnValidationErrors && errors.length > 0) {
    const errorMessage = errors.map(e => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Configuration validation failed: ${errorMessage}`);
  }

  return { config: config as AppConfig, errors };
}

/**
 * Create a configuration loader instance
 */
export class ConfigLoader {
  private cachedConfig: AppConfig | null = null;
  private cachedErrors: ConfigValidationError[] = [];

  async load(options?: ConfigLoadOptions): Promise<AppConfig> {
    const { config, errors } = await loadConfig(options);
    this.cachedConfig = config;
    this.cachedErrors = errors;
    return config;
  }

  get(): AppConfig | null {
    return this.cachedConfig;
  }

  getErrors(): ConfigValidationError[] {
    return [...this.cachedErrors];
  }

  hasErrors(): boolean {
    return this.cachedErrors.length > 0;
  }
}