import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: [
      '@babylonjs/core',
      '@babylonjs/loaders/glTF',
      '@babylonjs/havok',
      '@babylonjs/core/Physics/joinedPhysicsEngineComponent',
      '@babylonjs/core/Shaders/particles.vertex',
      '@babylonjs/core/Shaders/particles.fragment',
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        realtime: 'realtime.html',
        builder: 'builder.html',
        marketplace: 'marketplace.html',
        gloflux: 'gloflux.html',
        fps: 'fps.html'
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