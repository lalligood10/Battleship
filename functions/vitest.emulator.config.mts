import { defineConfig } from 'vitest/config';

// Integration tests that need the Firestore emulator. Run via `npm run test:emulator`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
