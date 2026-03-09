/**
 * marketplace-main.js — UI controller for the Addon Marketplace page.
 *
 * Renders the category tabs, add-on cards, wallet connection button,
 * and purchase flow. All blockchain operations are stubbed via marketplace.js.
 */

import {
  ADDON_CATEGORIES,
  ADDON_CATALOGUE,
  getWalletState,
  connectWallet,
  disconnectWallet,
  purchaseAddon,
  restoreUnlocks,
  onMarketplaceEvent,
} from './modules/marketplace.js';

// ── State ───────────────────────────────────────────────────────────────────
let activeCategory = 'karts';

// ── DOM refs ────────────────────────────────────────────────────────────────
const walletBtn      = () => document.getElementById('wallet-btn');
const balanceDisplay = () => document.getElementById('balance-display');
const categoryTabs   = () => document.getElementById('category-tabs');
const addonGrid      = () => document.getElementById('addon-grid');
const toastContainer = () => document.getElementById('toast-container');

// ── Render helpers ──────────────────────────────────────────────────────────

function renderTabs() {
  const nav = categoryTabs();
  if (!nav) return;
  nav.innerHTML = '';

  for (const cat of ADDON_CATEGORIES) {
    const btn = document.createElement('button');
    btn.textContent = `${cat.icon} ${cat.label}`;
    btn.dataset.catId = cat.id;
    btn.style.cssText = `
      padding:8px 18px;border:1px solid #333;border-radius:6px;cursor:pointer;
      background:${cat.id === activeCategory ? '#222' : 'transparent'};
      color:${cat.id === activeCategory ? '#fff' : '#888'};
      font-family:inherit;font-size:14px;transition:background .2s;
    `;
    btn.addEventListener('click', () => {
      activeCategory = cat.id;
      renderTabs();
      renderGrid();
    });
    nav.appendChild(btn);
  }
}

function renderGrid() {
  const grid = addonGrid();
  if (!grid) return;
  grid.innerHTML = '';

  const items = ADDON_CATALOGUE.filter(a => a.category === activeCategory);
  const wallet = getWalletState();

  for (const addon of items) {
    const card = document.createElement('div');
    card.style.cssText = `
      background:#151515;border:1px solid #222;border-radius:12px;
      padding:20px;display:flex;flex-direction:column;gap:12px;
      transition:border-color .2s;
    `;
    card.addEventListener('mouseenter', () => { card.style.borderColor = '#444'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = '#222'; });

    const icon = document.createElement('div');
    icon.textContent = addon.icon;
    icon.style.fontSize = '48px';

    const name = document.createElement('div');
    name.textContent = addon.name;
    name.style.cssText = 'font-size:18px;font-weight:600;';

    const desc = document.createElement('div');
    desc.textContent = addon.desc;
    desc.style.cssText = 'font-size:13px;color:#888;line-height:1.4;';

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:auto;';

    const price = document.createElement('span');
    price.textContent = addon.unlocked ? 'OWNED' : `${addon.price} GLOs`;
    price.style.cssText = `font-size:14px;font-weight:600;color:${addon.unlocked ? '#4caf50' : '#ffca28'};`;

    const buyBtn = document.createElement('button');
    buyBtn.textContent = addon.unlocked ? '✓' : 'Buy';
    buyBtn.disabled = addon.unlocked;
    buyBtn.style.cssText = `
      padding:6px 16px;border:none;border-radius:6px;cursor:${addon.unlocked ? 'default' : 'pointer'};
      background:${addon.unlocked ? '#333' : 'linear-gradient(135deg,#7c4dff,#00e5ff)'};
      color:#fff;font-family:inherit;font-size:13px;font-weight:600;
      opacity:${addon.unlocked ? '0.5' : '1'};
    `;
    if (!addon.unlocked) {
      buyBtn.addEventListener('click', () => handlePurchase(addon.id, buyBtn));
    }

    footer.appendChild(price);
    footer.appendChild(buyBtn);
    card.append(icon, name, desc, footer);
    grid.appendChild(card);
  }
}

function updateWalletUI() {
  const state = getWalletState();
  const btn = walletBtn();
  const bal = balanceDisplay();

  if (state.connected) {
    if (btn) {
      btn.textContent = shortenAddress(state.address);
      btn.style.background = '#333';
    }
    if (bal) {
      bal.textContent = `${state.balance.toLocaleString()} GLOs`;
      bal.style.color = '#ffca28';
    }
  } else {
    if (btn) {
      btn.textContent = 'Connect Wallet';
      btn.style.background = 'linear-gradient(135deg,#7c4dff,#00e5ff)';
    }
    if (bal) {
      bal.textContent = '—';
      bal.style.color = '#888';
    }
  }
}

function shortenAddress(addr) {
  if (!addr) return '—';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// ── Toast notifications ─────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = toastContainer();
  if (!container) return;
  const toast = document.createElement('div');
  const bg = type === 'success' ? '#2e7d32' : type === 'error' ? '#c62828' : '#1565c0';
  toast.style.cssText = `
    padding:12px 20px;border-radius:8px;background:${bg};color:#fff;
    font-size:14px;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,.4);
    animation:fadeIn .3s;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function handleWalletClick() {
  const state = getWalletState();
  if (state.connected) {
    await disconnectWallet();
  } else {
    walletBtn().textContent = 'Connecting...';
    walletBtn().disabled = true;
    try {
      await connectWallet();
      showToast('Wallet connected!', 'success');
    } catch (e) {
      showToast('Connection failed.', 'error');
    }
    walletBtn().disabled = false;
  }
  updateWalletUI();
  renderGrid();
}

async function handlePurchase(addonId, buttonEl) {
  const state = getWalletState();
  if (!state.connected) {
    showToast('Connect your wallet first.', 'error');
    return;
  }

  buttonEl.textContent = '...';
  buttonEl.disabled = true;

  const result = await purchaseAddon(addonId);

  if (result.success) {
    showToast(result.message, 'success');
  } else {
    showToast(result.message, 'error');
  }

  updateWalletUI();
  renderGrid();
}

// ── Event listeners ─────────────────────────────────────────────────────────

onMarketplaceEvent((ev) => {
  if (ev.type === 'purchase_complete') {
    updateWalletUI();
    renderGrid();
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

function init() {
  restoreUnlocks();
  renderTabs();
  renderGrid();
  updateWalletUI();

  const btn = walletBtn();
  if (btn) btn.addEventListener('click', handleWalletClick);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
