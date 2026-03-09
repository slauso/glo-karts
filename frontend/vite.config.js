import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        game: 'game.html',
        battle: 'battle.html',
        realtime: 'realtime.html',
        builder: 'builder.html',
        splitscreen: 'splitscreen.html',
        marketplace: 'marketplace.html',
        gloflux: 'gloflux.html'
      },
      output: {
        manualChunks: {
          'babylon-core': ['@babylonjs/core'],
          'babylon-loaders': ['@babylonjs/loaders'],
          'havok': ['@babylonjs/havok'],
          'three': ['three'],
          'colyseus': ['colyseus.js'],
        }
      }
    }
  }
});