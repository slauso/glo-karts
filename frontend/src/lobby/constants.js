// Lobby constants & pure helpers — extracted from lobby.js (Phase 1.x).
// No DOM, no Colyseus, no class state. Safe to import from any subsystem.

import { getMode, getLegacyModeFamily as canonicalGetLegacyModeFamily } from '../game-modes.js';
import { ALL_ARENAS, ALL_TRACKS, CUSTOM_TRACK_ID } from '../modules/content-registry.js';
import { StudioAPI } from '../editor3/studio-api.js';

// Phase 2.5: id used for the local browser draft (gloKartsStudio.lastTrack)
// surfaced inside the lobby dropdown so a host can broadcast their unsaved
// editor draft to peers via customTrackData (LobbyRoom already supports it).
export const LOCAL_DRAFT_TRACK_ID = '__local_draft__';
const LOCAL_DRAFT_STORAGE_KEY = 'gloKartsStudio.lastTrack';

export function readLocalDraftTrack() {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const placements = parsed?.track?.placements || parsed?.placements || [];
    if (!placements.length) return null;
    return { raw, name: parsed?.track?.name || parsed?.name || 'Local draft', placements: placements.length };
  } catch {
    return null;
  }
}

// ── Studio track cache ──────────────────────────────────────────────
// Phase 2.4: the unified `online_arena` mode pulls courses from the
// Track Studio backend (templates / community / mine). We cache the
// flattened list here so getSelectableContentList can stay synchronous
// (the lobby UI re-renders the dropdown after loadStudioTracks resolves).
let _studioTrackCache = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Tutorial Loop', source: 'template' },
];
let _studioTracksLoaded = false;
let _studioLoadPromise = null;

export function getStudioTrackCache() {
  return _studioTrackCache.slice();
}

export function isStudioTracksLoaded() {
  return _studioTracksLoaded;
}

/** Fetch templates + community + mine; dedupe and cache. Returns the cache. */
export async function loadStudioTracks({ force = false } = {}) {
  if (_studioLoadPromise && !force) return _studioLoadPromise;
  _studioLoadPromise = (async () => {
    const seen = new Map();
    const ingest = (rows, source) => {
      for (const row of rows || []) {
        if (!row || !row.id) continue;
        if (seen.has(row.id)) continue;
        seen.set(row.id, {
          id: row.id,
          name: row.name || '(untitled)',
          source,
          author: row.author_name || '',
        });
      }
    };
    const safe = (p) => p.then((r) => r?.results || r || []).catch(() => []);
    const [templates, community, mine] = await Promise.all([
      safe(StudioAPI.templates({ page: 1 })),
      safe(StudioAPI.community({ page: 1, sort: 'popular' })),
      safe(StudioAPI.mine({ page: 1 })),
    ]);
    ingest(mine, 'mine');
    ingest(templates, 'template');
    ingest(community, 'community');
    _studioTrackCache = Array.from(seen.values());
    _studioTracksLoaded = true;
    return _studioTrackCache;
  })();
  return _studioLoadPromise;
}

export const DEFAULTS = {
  mode: 'battle',
  battleType: 'deathmatch',
  maxPlayers: 8,
  botCount: 0,
  loadoutId: 'random-all',
  scoreLimit: 5,
  arenaId: 'glo_arena',
  trackId: 'glo_arena',
};

export const BUILDER_LAUNCH_INTENT_KEY = 'gloBuilderLaunchIntent';
export const PERFORMANCE_MODE_STORAGE_KEY = 'gloPerformanceMode';
export const PERFORMANCE_MODE = Object.freeze({
  AUTO: 'auto',
  ULTRA_LOW: 'ultra_low',
});

export function normalizePerformanceMode(value) {
  return value === PERFORMANCE_MODE.ULTRA_LOW ? PERFORMANCE_MODE.ULTRA_LOW : PERFORMANCE_MODE.AUTO;
}

export function getPerformanceModeMeta(mode) {
  if (mode === PERFORMANCE_MODE.ULTRA_LOW) {
    return {
      summary: 'Ultra-Low',
      note: 'Ultra-Low is active. Realtime battles will force the weakest-device graphics profile and aggressive resolution scaling.',
    };
  }

  return {
    summary: 'Auto Detect',
    note: 'Auto Detect is active. GLO KARTS will choose the default device tier and adapt when the match gets heavy.',
  };
}

export const BATTLE_WEAPON_LIBRARY = [
  { id: 'bowling_ball', label: 'Bowling Ball', icon: '🎳' },
  { id: 'plunger', label: 'Plunger', icon: '🪠' },
  { id: 'cake', label: 'Cake Missile', icon: '🎂' },
  { id: 'bubblegum', label: 'Bubblegum Trap', icon: '🫧' },
  { id: 'swatter', label: 'Swatter', icon: '🪰' },
  { id: 'nitro', label: 'Nitro Flask', icon: '⚗️' },
  { id: 'shield', label: 'Shield', icon: '🛡️' },
  { id: 'banana', label: 'Banana', icon: '🍌' },
  { id: 'anchor', label: 'Anchor', icon: '⚓' },
  { id: 'missile', label: 'Missile', icon: '🚀' },
  { id: 'crimson_hydra', label: 'Crimson Hydra', icon: '🐉' },
  { id: 'lightning_bolt', label: 'Lightning', icon: '⚡' },
  { id: 'tornado', label: 'Tornado', icon: '🌪️' },
];

export const BATTLE_RULE_PRESETS = {
  classic: {
    battleType: 'deathmatch',
    loadoutId: 'combat',
    scoreLimit: 7,
    maxPlayers: 8,
    matchLength: '8',
    healthMultiplier: '1',
    respawnTime: '4',
    randomSpawns: true,
    powerWeapons: true,
    collisionDamage: true,
    friendlyFire: false,
    radarEnabled: true,
    autoAim: true,
    oneHitKills: false,
  },
  'golden-gun': {
    battleType: 'deathmatch',
    loadoutId: 'custom',
    scoreLimit: 1,
    maxPlayers: 8,
    matchLength: '5',
    healthMultiplier: '0.75',
    respawnTime: '6',
    randomSpawns: false,
    powerWeapons: false,
    collisionDamage: false,
    friendlyFire: true,
    radarEnabled: false,
    autoAim: false,
    oneHitKills: true,
    customWeapons: ['plunger', 'missile'],
  },
  mayhem: {
    battleType: 'ctf',
    loadoutId: 'chaos',
    scoreLimit: 10,
    maxPlayers: 8,
    matchLength: '12',
    healthMultiplier: '1.5',
    respawnTime: '2',
    randomSpawns: true,
    powerWeapons: true,
    collisionDamage: true,
    friendlyFire: true,
    radarEnabled: true,
    autoAim: true,
    oneHitKills: false,
  },
};

export function getLegacyModeFamily(modeId) {
  // Phase 1.2: Delegate to game-modes.js (single source of truth).
  return canonicalGetLegacyModeFamily(modeId);
}

export function usesArenaSelection(modeId) {
  return !!getMode(modeId)?.selectors?.arena;
}

export function usesTrackSelection(modeId) {
  return !!getMode(modeId)?.selectors?.track;
}

export function usesStudioTracks(modeId) {
  return !!getMode(modeId)?.selectors?.studioTracks;
}

export function getSelectableContentList(modeId) {
  if (usesStudioTracks(modeId)) {
    // Phase 2.4/2.5: show backend-saved Studio tracks, grouped by source
    // (Templates / Community / My Saves), plus the host's local browser
    // draft if one exists. Group headers are emitted as non-selectable
    // entries with `header: true`.
    const out = [];
    const draft = readLocalDraftTrack();
    if (draft) {
      out.push({ id: 'hdr-local', name: '— Your draft —', header: true });
      out.push({
        id: LOCAL_DRAFT_TRACK_ID,
        name: `${draft.name} (browser draft, ${draft.placements} pieces)`,
        source: 'local',
      });
    }
    const grouped = { mine: [], template: [], community: [] };
    for (const t of _studioTrackCache) {
      (grouped[t.source] || grouped.template).push(t);
    }
    if (grouped.mine.length) {
      out.push({ id: 'hdr-mine', name: '— My saves —', header: true });
      for (const t of grouped.mine) out.push({ id: t.id, name: t.name, source: 'mine' });
    }
    if (grouped.template.length) {
      out.push({ id: 'hdr-templates', name: '— Templates —', header: true });
      for (const t of grouped.template) out.push({ id: t.id, name: t.name, source: 'template' });
    }
    if (grouped.community.length) {
      out.push({ id: 'hdr-community', name: '— Remix community —', header: true });
      for (const t of grouped.community) {
        const suffix = t.author ? `  ·  by ${t.author}` : '';
        out.push({ id: t.id, name: `${t.name}${suffix}`, source: 'community' });
      }
    }
    return out;
  }
  if (usesArenaSelection(modeId)) {
    return Object.values(ALL_ARENAS).map((entry) => ({ id: entry.id, name: entry.label }));
  }

  if (usesTrackSelection(modeId)) {
    return Object.values(ALL_TRACKS)
      .filter((entry) => entry.id !== CUSTOM_TRACK_ID)
      .map((entry) => ({ id: entry.id, name: entry.label }));
  }

  return [];
}

const PARTY_CODE_FIRST_WORDS = [
  'NEON', 'TURBO', 'NOVA', 'LUNAR', 'SOLAR', 'RAPID', 'HYPER', 'WILD',
  'GOLD', 'SILVER', 'CRIMSON', 'ELECTRIC', 'GLASS', 'MIDNIGHT', 'RADAR', 'COMET',
  'ROCKET', 'PIXEL', 'FROST', 'EMBER', 'THUNDER', 'BLAZING', 'COSMIC', 'PHANTOM',
];

const PARTY_CODE_SECOND_WORDS = [
  'FOX', 'WOLF', 'TIGER', 'RACER', 'VIPER', 'RIDER', 'PILOT', 'DRIVER',
  'FALCON', 'PANTHER', 'OTTER', 'COBRA', 'JAGUAR', 'COMET', 'BLADE', 'EAGLE',
  'RHINO', 'BADGER', 'HAWK', 'RAVEN', 'ORBIT', 'NITRO', 'KART', 'THRUSTER',
];

const PARTY_CODE_THIRD_WORDS = [
  'BOOST', 'DRIFT', 'DASH', 'BLITZ', 'CHASE', 'SPRINT', 'RALLY', 'CIRCUIT',
  'ARENA', 'ROCKET', 'FUSION', 'STORM', 'CLUTCH', 'VICTORY', 'CHARGE', 'GLIDE',
  'FLASH', 'RUMBLE', 'SKID', 'TURN', 'VAULT', 'BURST', 'GRID', 'START',
];

export function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function normalizeLobbyCode(raw) {
  const tokens = String(raw || '').trim().toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (!tokens.length) return '';

  const looksLegacyCode = tokens.every((token) => token.length <= 3) && tokens.some((token) => /\d/.test(token));
  if (looksLegacyCode) {
    return tokens.slice(0, 3).join('-');
  }

  return tokens
    .map((token) => token.replace(/\d+/g, ''))
    .filter(Boolean)
    .slice(0, 3)
    .join('-');
}

export function generateLobbyCode() {
  return `${pickRandom(PARTY_CODE_FIRST_WORDS)}-${pickRandom(PARTY_CODE_SECOND_WORDS)}-${pickRandom(PARTY_CODE_THIRD_WORDS)}`;
}

export function getStoredGlo() {
  return {
    gloEffect: sessionStorage.getItem('gloEffect') || 'solid',
    gloColor: sessionStorage.getItem('gloColor') || '#ff0080',
    gloColor2: sessionStorage.getItem('gloColor2') || '#00e5ff',
  };
}
