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
        // battle.html retired 2026-05-10 — local Ammo battle superseded by realtime.html (Havok PvP).
        realtime: 'realtime.html',
        editor: 'editor.html',
        play: 'play.html',
        // Phase 2 — online race driven by editor3 stack (Three.js + cannon-es server).
        multiplayerEditor3: 'multiplayer-editor3.html'
      }
    }
  }
});