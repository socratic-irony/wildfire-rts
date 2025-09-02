export interface LoggingConfig {
  verbosity: 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';
  enableConsoleTimestamps: boolean;
  enablePerformanceLogs: boolean;
}

export interface DebugConfig {
  showStats: boolean;
  enableGridOverlay: boolean;
  enableWireframe: boolean;
}

export interface RenderingConfig {
  antialias: boolean;
  shadows: boolean;
  maxPixelRatio: number;
}

export interface FeaturesConfig {
  enableExperimentalFeatures: boolean;
}

export interface AppConfig {
  logging: LoggingConfig;
  debug: DebugConfig;
  rendering: RenderingConfig;
  features: FeaturesConfig;
}

export interface ConfigValidationError {
  path: string;
  message: string;
  value?: any;
}

export interface ConfigLoadOptions {
  allowEnvironmentOverrides?: boolean;
  throwOnValidationErrors?: boolean;
}