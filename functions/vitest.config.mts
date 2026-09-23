import { defineConfig } from 'vitest/config';

// Pure unit tests – no emulator needed.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
