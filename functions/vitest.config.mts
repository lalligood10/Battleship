import { defineConfig } from 'vitest/config';

// Pure unit tests – no emulator needed.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/game/core/**/*.ts', 'src/game/engine.ts'],
      exclude: ['src/game/core/**/*.test.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
