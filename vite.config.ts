import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: here('./src/client'),
  publicDir: here('./src/client/public'),
  plugins: [react()],
  build: {
    outDir: here('./dist/client'),
    emptyOutDir: true,
    target: 'es2022',
    // Inline nothing as data: URIs so the production CSP can stay strict.
    assetsInlineLimit: 0,
  },
});
