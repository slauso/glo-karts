import { defineConfig } from 'vite';

export default defineConfig({
  // Allow the dev server (and physics worker) to import the shared kart
  // physics module that lives in ../realtime/src/. Both SP playtest and
  // the online race server consume the same source-of-truth file so kart
  // handling stays 1:1 across modes.
  server: { fs: { allow: ['..'] } },
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