import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { validateAssets, ASSET_RULES, calculateFileHash } from '../../scripts/assets/validate.js';

describe('Asset Validation', () => {
  const testDir = '/tmp/test-assets';
  
  beforeEach(() => {
    // Clean up any existing test directory
    try {
      rmSync(testDir, { recursive: true });
    } catch (e) {
      // Directory doesn't exist, which is fine
    }
    
    // Create test directory structure
    mkdirSync(join(testDir, 'src', 'assets', 'models'), { recursive: true });
    mkdirSync(join(testDir, 'src', 'assets', 'stills'), { recursive: true });
  });
  
  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('should validate file sizes correctly', () => {
    // Create a small GLB file (under limit)
    const smallModel = Buffer.alloc(1024 * 1000); // 1MB
    writeFileSync(join(testDir, 'src', 'assets', 'models', 'small.glb'), smallModel);
    
    // Create a large GLB file (over limit)
    const largeModel = Buffer.alloc(1024 * 3000); // 3MB
    writeFileSync(join(testDir, 'src', 'assets', 'models', 'large.glb'), largeModel);
    
    const results = validateAssets(testDir);
    
    expect(results.totalAssets).toBe(2);
    expect(results.validAssets).toBe(1); // Only small file should be valid
    expect(results.errors.length).toBeGreaterThan(0);
    expect(results.errors.some(err => err.includes('large.glb'))).toBe(true);
    expect(results.errors.some(err => err.includes('exceeds limit'))).toBe(true);
  });

  it('should generate correct file hashes', () => {
    const testContent = 'test file content';
    const testFile = join(testDir, 'src', 'assets', 'models', 'test.glb');
    writeFileSync(testFile, testContent);
    
    const hash = calculateFileHash(testFile);
    
    // Should be a valid SHA256 hash (64 characters)
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    
    // Same content should produce same hash
    const hash2 = calculateFileHash(testFile);
    expect(hash).toBe(hash2);
  });

  it('should identify asset types correctly', () => {
    // Create test files of different types
    writeFileSync(join(testDir, 'src', 'assets', 'models', 'test.glb'), 'model data');
    writeFileSync(join(testDir, 'src', 'assets', 'stills', 'test.png'), 'image data');
    
    const results = validateAssets(testDir);
    
    const modelAsset = results.assets.find(a => a.path.includes('test.glb'));
    const imageAsset = results.assets.find(a => a.path.includes('test.png'));
    
    expect(modelAsset).toBeDefined();
    expect(imageAsset).toBeDefined();
  });

  it('should apply size warnings correctly', () => {
    // Create a file that's 90% of the limit (should trigger warning)
    const warningSize = Math.floor(ASSET_RULES.models.maxSizeKB * 0.9 * 1024);
    const warningModel = Buffer.alloc(warningSize);
    writeFileSync(join(testDir, 'src', 'assets', 'models', 'warning.glb'), warningModel);
    
    const results = validateAssets(testDir);
    
    expect(results.warnings.length).toBeGreaterThan(0);
    expect(results.warnings.some(warn => warn.includes('warning.glb'))).toBe(true);
    expect(results.warnings.some(warn => warn.includes('approaching limit'))).toBe(true);
  });

  it('should handle empty directories gracefully', () => {
    // Test with empty directory structure
    const results = validateAssets(testDir);
    
    expect(results.totalAssets).toBe(0);
    expect(results.validAssets).toBe(0);
    expect(results.errors).toHaveLength(0);
    expect(results.warnings).toHaveLength(0);
  });

  it('should validate asset rules configuration', () => {
    // Test that asset rules are properly configured
    expect(ASSET_RULES).toHaveProperty('models');
    expect(ASSET_RULES).toHaveProperty('images');
    expect(ASSET_RULES).toHaveProperty('audio');
    
    expect(ASSET_RULES.models.maxSizeKB).toBeGreaterThan(0);
    expect(ASSET_RULES.images.maxSizeKB).toBeGreaterThan(0);
    expect(ASSET_RULES.audio.maxSizeKB).toBeGreaterThan(0);
    
    expect(ASSET_RULES.models.extensions).toContain('.glb');
    expect(ASSET_RULES.images.extensions).toContain('.png');
    expect(ASSET_RULES.audio.extensions).toContain('.mp3');
  });
});