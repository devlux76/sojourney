import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  server: {
    port: 3000,
    host: '127.0.0.1',
    watch: { ignored: ['**/public/packs/**', '**/tools/**', '**/assets/**'] },
  },
});
