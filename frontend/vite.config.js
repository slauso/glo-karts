import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: [
      '@babylonjs/core',
    ],
    include: [
      '@babylonjs/loaders/glTF',
      '@babylonjs/havok',
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        game: 'game.html',
        battle: 'battle.html',
        builder: 'builder.html',
        realtime: 'realtime.html'
      }
    }
  }
});