import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// The pure game rules live in functions/src/game and are shared with the browser via the `@shared` alias,
// so the client previews exactly what the server will enforce.
const shared = fileURLToPath(new URL('../functions/src/game', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': shared },
  },
  server: {
    host: true,
    fs: { allow: ['..'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
