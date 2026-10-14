import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app imports ../js/inventory.js, ../js/store.js, ../js/export.js,
// ../css/style.css and ../data/sample-data.json from the vanilla build, so the
// dev server must be allowed to read the parent folder.
export default defineConfig({
  plugins: [react()],
  base: './', // relative paths, so the build works under any GitHub Pages sub-path
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  build: {
    outDir: '../react-app', // served by GitHub Pages at /<repo>/react-app/
    emptyOutDir: true,
  },
});
