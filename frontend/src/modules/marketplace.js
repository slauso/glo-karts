/**
 * marketplace.js — Addon Marketplace Framework Shell
 *
 * Provides stubs for thirdweb SDK integration:
 *  - Wallet connection (embedded / smart wallets)
 *  - GLOs token balance reads
 *  - Purchase flow (stubbed for beta)
 *  - Asset unlock tracking
 *
 * All blockchain operations are STUBBED. The shell exposes a clean API
 * so real thirdweb calls can be dropped in later without structural changes.
 */

// ── Marketplace catalogue ───────────────────────────────────────────────────

export const ADDON_CATEGORIES = [
  { id: 'karts',  label: 'Karts',  icon: '🏎️' },
  { id: 'tracks', label: 'Tracks', icon: '🛤️' },
  { id: 'skins',  label: 'Skins',  icon: '🎨' },
  { id: 'effects', label: 'Effects', icon: '✨' },
];

/**
 * Catalogue of purchasable add-ons.
 * `price` is in GLOs tokens. `unlocked` tracks local ownership.
 */
export const ADDON_CATALOGUE = [
  { id: 'kart_gold',     category: 'karts',   name: 'Gold Racer',       price: 500,  icon: '🏆', unlocked: false, desc: 'A gleaming all-gold chassis.' },
  { id: 'kart_cyber',    category: 'karts',   name: 'Cyber Sprint',     price: 750,  icon: '🤖', unlocked: false, desc: 'Neon-trimmed cyberpunk kart.' },
  { id: 'track_volcano', category: 'tracks',  name: 'Volcano Circuit',  price: 1200, icon: '🌋', unlocked: false, desc: 'Race through erupting lava fields.' },
  { id: 'track_space',   category: 'tracks',  name: 'Zero-G Orbital',   price: 1500, icon: '🚀', unlocked: false, desc: 'Anti-gravity track in orbit.' },
  { id: 'skin_flame',    category: 'skins',   name: 'Flame Wrap',       price: 300,  icon: '🔥', unlocked: false, desc: 'Fiery paint job for any kart.' },
  { id: 'skin_ice',      category: 'skins',   name: 'Ice Crystal',      price: 300,  icon: '❄️', unlocked: false, desc: 'Frozen tundra finish.' },
  { id: 'fx_confetti',   category: 'effects', name: 'Confetti Trail',   price: 200,  icon: '🎊', unlocked: false, desc: 'Celebrate every lap.' },
  { id: 'fx_rainbow',    category: 'effects', name: 'Rainbow Exhaust',  price: 400,  icon: '🌈', unlocked: false, desc: 'Prismatic boost particles.' },
];

// ── Wallet state ────────────────────────────────────────────────────────────

let _walletState = {
  connected: false,
  address: null,
  balance: 0,       // GLOs tokens (mock)
  chainId: null,
};

/** Get current wallet state (read-only copy). */
export function getWalletState() {
  return { ..._walletState };
}

/**
 * STUB — Connect wallet via thirdweb embedded/smart wallet.
 * In production this would call:
 *   const sdk = new ThirdwebSDK("base"); // or polygon
 *   const wallet = await sdk.wallet.connect("embedded");
 * For now we simulate a successful connection.
 */
export async function connectWallet() {
  // Simulate connection delay
  await _delay(800);

  _walletState = {
    connected: true,
    address: '0x' + _mockAddr(),
    balance: 5000,   // Give beta users 5000 GLOs to test with
    chainId: 8453,   // Base mainnet
  };

  _persistUnlocks();
  _notifyListeners('wallet_connected', _walletState);
  return { ..._walletState };
}

/** STUB — Disconnect wallet. */
export async function disconnectWallet() {
  _walletState = { connected: false, address: null, balance: 0, chainId: null };
  _notifyListeners('wallet_disconnected', null);
}

// ── Purchases ───────────────────────────────────────────────────────────────

/**
 * STUB — Purchase an add-on with GLOs tokens.
 * In production this would create a thirdweb marketplace listing transaction.
 * @param {string} addonId
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function purchaseAddon(addonId) {
  if (!_walletState.connected) {
    return { success: false, message: 'Wallet not connected.' };
  }

  const addon = ADDON_CATALOGUE.find(a => a.id === addonId);
  if (!addon) return { success: false, message: 'Add-on not found.' };
  if (addon.unlocked) return { success: false, message: 'Already owned.' };
  if (_walletState.balance < addon.price) {
    return { success: false, message: `Insufficient GLOs. Need ${addon.price}, have ${_walletState.balance}.` };
  }

  // Simulate transaction
  await _delay(1200);

  _walletState.balance -= addon.price;
  addon.unlocked = true;

  _persistUnlocks();
  _notifyListeners('purchase_complete', { addonId, addon, balance: _walletState.balance });
  return { success: true, message: `Purchased ${addon.name}!` };
}

/** Check which add-ons the current user owns. */
export function getUnlockedAddons() {
  return ADDON_CATALOGUE.filter(a => a.unlocked).map(a => a.id);
}

// ── Persistence (localStorage for beta) ─────────────────────────────────────

function _persistUnlocks() {
  const unlocked = ADDON_CATALOGUE.filter(a => a.unlocked).map(a => a.id);
  try { localStorage.setItem('marketplace_unlocks', JSON.stringify(unlocked)); } catch (_) {}
}

export function restoreUnlocks() {
  try {
    const saved = JSON.parse(localStorage.getItem('marketplace_unlocks') || '[]');
    for (const id of saved) {
      const addon = ADDON_CATALOGUE.find(a => a.id === id);
      if (addon) addon.unlocked = true;
    }
  } catch (_) {}
}

// ── Event system ────────────────────────────────────────────────────────────
const _listeners = [];

export function onMarketplaceEvent(callback) {
  _listeners.push(callback);
  return () => {
    const idx = _listeners.indexOf(callback);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

function _notifyListeners(type, data) {
  for (const cb of _listeners) {
    try { cb({ type, data }); } catch (_) {}
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function _mockAddr() {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}
