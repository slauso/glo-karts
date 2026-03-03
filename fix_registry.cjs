const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/content-registry.js';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/map1: .+/g, "map1: { id: 'map1', label: 'Amalfi Coast', trackPath: '/models/maps/map1/track.glb', decorationsPath: '/models/maps/map1/decorations.glb', scale: 8, startPositions: [{x: 0, y: 15, z: 0}, {x: 5, y: 15, z: 2}, {x: -5, y: 15, z: 2}, {x: 0, y: 15, z: 5}] },");
c = c.replace(/map2: .+/g, "map2: { id: 'map2', label: 'Desert Dunes', trackPath: '/models/maps/map2/track.glb', decorationsPath: '/models/maps/map2/decorations.glb', scale: 8, startPositions: [{x: 0, y: 15, z: 0}, {x: 5, y: 15, z: 0}] },");
c = c.replace(/abyss: .+/g, "abyss: { id: 'abyss', label: 'Abyss', trackPath: '/models/stk/tracks/abyss/track.glb', decorationsPath: '/models/stk/tracks/abyss/decorations.glb', scale: 1, startPositions: [{x: -36.26, y: 6.94, z: -5.73}, {x: -40, y: 7, z: -5}] },");
c = c.replace(/black_forest: .+/g, "black_forest: { id: 'black_forest', label: 'Black Forest', trackPath: '/models/stk/tracks/black_forest/track.glb', decorationsPath: '/models/stk/tracks/black_forest/decorations.glb', scale: 1, startPositions: [{x: 238.16, y: 0.17, z: -250.70}, {x: 242, y: 0.2, z: -250}] },");
c = c.replace(/cocoa_temple: .+/g, "cocoa_temple: { id: 'cocoa_temple', label: 'Cocoa Temple', trackPath: '/models/stk/tracks/cocoa_temple/track.glb', decorationsPath: '/models/stk/tracks/cocoa_temple/decorations.glb', scale: 1, startPositions: [{x: -188.58, y: 13.91, z: 279.79}, {x: -184, y: 14, z: 275}] },");
c = c.replace(/cornfield_crossing: .+/g, "cornfield_crossing: { id: 'cornfield_crossing', label: 'Cornfield Xing', trackPath: '/models/stk/tracks/cornfield_crossing/track.glb', decorationsPath: '/models/stk/tracks/cornfield_crossing/decorations.glb', scale: 1, startPositions: [{x: 9.38, y: 4.88, z: 71.93}, {x: 13, y: 5, z: 75}] },");
c = c.replace(/zengarden: .+/g, "zengarden: { id: 'zengarden', label: 'Zen Garden', trackPath: '/models/stk/tracks/zengarden/track.glb', decorationsPath: '/models/stk/tracks/zengarden/decorations.glb', scale: 1, startPositions: [{x: 104.53, y: 12.30, z: -43.20}, {x: 108, y: 12.5, z: -45}] },");

c = c.replace(/battleisland: .+/g, "battleisland: { id: 'battleisland', label: 'Battle Island', arenaPath: '/models/stk/arenas/battleisland/arena.glb', scale: 1, startPositions: [{x: -7, y: 5, z: -10}, {x: 7, y: 5, z: 10}] },");
c = c.replace(/las_dunas: .+/g, "las_dunas: { id: 'las_dunas', label: 'Las Dunas Arena', arenaPath: '/models/stk/arenas/las_dunas/arena.glb', scale: 1, startPositions: [{x: -42.06, y: -23.18, z: 26.68}, {x: 20, y: -23, z: 20}] },");
c = c.replace(/volcano_island: .+/g, "volcano_island: { id: 'volcano_island', label: 'Volcano Island', arenaPath: '/models/stk/arenas/volcano_island/arena.glb', scale: 1, startPositions: [{x: -54.78, y: -0.4, z: 4.6}, {x: -60, y: 0, z: 10}] },");

fs.writeFileSync(p, c);
console.log('Added startPositions to registry');
