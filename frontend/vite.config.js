import { defineConfig } from 'vite';

export default defineConfig({
  // Multi-page app: index.html, editor.html, play.html, etc. are all
  // first-class entry points. Without appType:'mpa' Vite's dev server
  // falls back to serving index.html for any unknown extension — which
  // includes our static .dae / .spm / .fbx assets when the browser sends
  // an Accept: text/html header. That fallback returns 200 + HTML for
  // ColladaLoader / SPMLoader and they fail to parse. Forcing MPA mode
  // disables the SPA fallback so unknown paths return real 404s and
  // public/ binary assets always serve as the actual file.
  appType: 'mpa',
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