/**
 * Feature flag configuration system for wildfire RTS
 * 
 * Provides centralized feature toggles and configuration management
 * following the requirement to avoid coupling with forbidden systems.
 */

interface DebugConfig {
  overlay_visible_on_start: boolean;
  console_enabled: boolean;
  memory_metrics_enabled: boolean;
  performance_monitoring: boolean;
}

interface Features {
  debug_overlay: boolean;
  console_commands: boolean;
  advanced_metrics: boolean;
}

interface AppConfig {
  features: Features;
  debug: DebugConfig;
}

/**
 * Default configuration
 */
const defaultConfig: AppConfig = {
  features: {
    debug_overlay: true,
    console_commands: true,
    advanced_metrics: true,
  },
  debug: {
    overlay_visible_on_start: true,
    console_enabled: true,
    memory_metrics_enabled: true,
    performance_monitoring: false,
  }
};

/**
 * Global configuration instance
 */
export let config: AppConfig = {
  features: { ...defaultConfig.features },
  debug: { ...defaultConfig.debug },
};

/**
 * Update configuration at runtime
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  config = {
    ...config,
    ...updates,
    features: { ...config.features, ...updates.features },
    debug: { ...config.debug, ...updates.debug },
  };
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
  config = {
    features: { ...defaultConfig.features },
    debug: { ...defaultConfig.debug },
  };
}

/**
 * Get a configuration value by path
 */
export function getConfigValue(path: string): any {
  const keys = path.split('.');
  let current: any = config;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  
  return current;
}

/**
 * Set a configuration value by path
 */
export function setConfigValue(path: string, value: any): void {
  const keys = path.split('.');
  let current: any = config;
  
  // Navigate to parent object
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  // Set the final value
  current[keys[keys.length - 1]] = value;
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof Features): boolean {
  return config.features[feature] === true;
}

/**
 * Enable/disable a feature
 */
export function setFeature(feature: keyof Features, enabled: boolean): void {
  config.features[feature] = enabled;
}