import { describe, it, expect, beforeEach } from 'vitest';
import { 
  config, 
  updateConfig, 
  resetConfig, 
  getConfigValue, 
  setConfigValue,
  isFeatureEnabled,
  setFeature
} from '../config/features';

describe('Configuration System', () => {
  beforeEach(() => {
    resetConfig();
  });

  describe('default configuration', () => {
    it('should have debug overlay enabled by default', () => {
      expect(config.features.debug_overlay).toBe(true);
    });

    it('should have console commands enabled by default', () => {
      expect(config.features.console_commands).toBe(true);
    });

    it('should have memory metrics enabled by default', () => {
      expect(config.debug.memory_metrics_enabled).toBe(true);
    });
  });

  describe('configuration updates', () => {
    it('should update feature flags', () => {
      updateConfig({
        features: { debug_overlay: false, console_commands: true, advanced_metrics: true }
      });
      expect(config.features.debug_overlay).toBe(false);
      expect(config.features.console_commands).toBe(true); // unchanged
    });

    it('should update debug settings', () => {
      updateConfig({
        debug: { overlay_visible_on_start: false, console_enabled: true, memory_metrics_enabled: true, performance_monitoring: false }
      });
      expect(config.debug.overlay_visible_on_start).toBe(false);
      expect(config.debug.memory_metrics_enabled).toBe(true); // unchanged
    });
  });

  describe('configuration path access', () => {
    it('should get values by path', () => {
      expect(getConfigValue('features.debug_overlay')).toBe(true);
      expect(getConfigValue('debug.memory_metrics_enabled')).toBe(true);
      expect(getConfigValue('nonexistent.path')).toBeUndefined();
    });

    it('should set values by path', () => {
      setConfigValue('features.debug_overlay', false);
      expect(config.features.debug_overlay).toBe(false);
      
      setConfigValue('debug.new_setting', 'test');
      expect(getConfigValue('debug.new_setting')).toBe('test');
    });
  });

  describe('feature management', () => {
    it('should check if features are enabled', () => {
      expect(isFeatureEnabled('debug_overlay')).toBe(true);
      expect(isFeatureEnabled('console_commands')).toBe(true);
    });

    it('should enable/disable features', () => {
      setFeature('debug_overlay', false);
      expect(isFeatureEnabled('debug_overlay')).toBe(false);
      
      setFeature('debug_overlay', true);
      expect(isFeatureEnabled('debug_overlay')).toBe(true);
    });
  });

  describe('configuration reset', () => {
    it('should reset to defaults', () => {
      // Modify config
      updateConfig({
        features: { debug_overlay: false, console_commands: true, advanced_metrics: true },
        debug: { memory_metrics_enabled: false, overlay_visible_on_start: true, console_enabled: true, performance_monitoring: false }
      });
      
      // Verify changes
      expect(config.features.debug_overlay).toBe(false);
      expect(config.debug.memory_metrics_enabled).toBe(false);
      
      // Reset
      resetConfig();
      
      // Verify reset
      expect(config.features.debug_overlay).toBe(true);
      expect(config.debug.memory_metrics_enabled).toBe(true);
    });
  });
});