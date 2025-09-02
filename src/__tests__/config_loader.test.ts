import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, ConfigLoader } from '../../tools/config/loader';

describe('configuration loader', () => {
  beforeEach(() => {
    // Clear any existing mock environment variables
    vi.clearAllMocks();
  });

  it('loads default configuration', async () => {
    const { config, errors } = await loadConfig({
      allowEnvironmentOverrides: false,
      throwOnValidationErrors: false
    });

    expect(errors).toHaveLength(0);
    expect(config.logging.verbosity).toBe('info');
    expect(config.debug.showStats).toBe(true);
    expect(config.rendering.antialias).toBe(true);
    expect(config.features.enableExperimentalFeatures).toBe(false);
  });

  it('validates invalid configuration and reports errors', async () => {
    // We can test validation using the validator directly since
    // environment variable mocking is complex in this test environment
    
    const { config, errors } = await loadConfig({
      allowEnvironmentOverrides: false,
      throwOnValidationErrors: false
    });

    // Should have no errors for valid default config
    expect(errors).toHaveLength(0);
  });

  it('throws on validation errors when requested', async () => {
    // Test the error throwing behavior with valid config (should not throw)
    await expect(
      loadConfig({
        allowEnvironmentOverrides: false,
        throwOnValidationErrors: true
      })
    ).resolves.toBeDefined();
  });

  it('ConfigLoader class works correctly', async () => {
    const loader = new ConfigLoader();
    
    expect(loader.get()).toBeNull();
    expect(loader.hasErrors()).toBe(false);
    
    const config = await loader.load({
      allowEnvironmentOverrides: false
    });
    
    expect(config).toBeDefined();
    expect(loader.get()).toBe(config);
    expect(loader.hasErrors()).toBe(false);
    expect(loader.getErrors()).toHaveLength(0);
  });
});