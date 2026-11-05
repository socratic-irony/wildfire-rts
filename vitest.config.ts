import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // World generation tests take a few seconds; leave headroom on busy machines.
    testTimeout: 20000,
  },
});
