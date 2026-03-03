import {
  ALL_TRACKS,
  getSinglePlayerCupsInOrder,
  isCupUnlocked,
  resolveTimeAttackTargets,
} from './modules/content-registry.js';

function readProgressState() {
  try {
    const parsed = JSON.parse(localStorage.getItem('singlePlayerProgress') || '{}');
    if (!parsed.cups) parsed.cups = {};
    if (!parsed.timeAttack) parsed.timeAttack = {};
    return parsed;
  } catch {
    return { cups: {}, timeAttack: {} };
  }
}

function formatRaceTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--.--';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  const millis = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function renderSummary(progress) {
  const container = document.getElementById('garage-summary');
  if (!container) return;

  const cups = getSinglePlayerCupsInOrder();
  const completedCups = cups.filter((cup) => progress?.cups?.[cup.id]?.completed).length;
  const totalCupPoints = cups.reduce((sum, cup) => {
    return sum + Number(progress?.cups?.[cup.id]?.totalPoints || 0);
  }, 0);

  const medals = Object.values(progress?.timeAttack || {}).filter((entry) => !!entry?.medal).length;

  container.innerHTML = `
    <div class="progress-kpi">Cups Cleared<strong>${completedCups}/${cups.length}</strong></div>
    <div class="progress-kpi">Total Cup Score<strong>${totalCupPoints}</strong></div>
    <div class="progress-kpi">Time Attack Medals<strong>${medals}</strong></div>
  `;
}

function renderCupCabinet(progress) {
  const container = document.getElementById('garage-cups');
  if (!container) return;

  const cups = getSinglePlayerCupsInOrder();
  container.innerHTML = '';

  cups.forEach((cup) => {
    const cupProgress = progress?.cups?.[cup.id] || {};
    const unlocked = isCupUnlocked(cup.id, progress);
    const races = Array.isArray(cupProgress.races) ? cupProgress.races.filter(Boolean) : [];
    const medals = Array.isArray(cupProgress.medals) ? cupProgress.medals.filter(Boolean) : [];

    const card = document.createElement('div');
    card.className = `cup-card garage-cup${cupProgress.completed ? ' active' : ''}${unlocked ? '' : ' locked'}`;
    card.innerHTML = `
      <div class="cup-head">
        <span class="cup-icon">${cup.icon || '🏁'}</span>
        <span class="cup-title">${cup.label}</span>
      </div>
      <div class="cup-theme">${cup.theme || ''}</div>
      <div class="cup-meta">
        <span>Races ${races.length}/${cup.trackIds.length}</span>
        <span>${cupProgress.completed ? 'Trophy Earned' : (unlocked ? 'Unlocked' : 'Locked')}</span>
      </div>
      <div class="garage-cup-score">${Number(cupProgress.totalPoints || 0)} pts</div>
      <div class="garage-medal-row">${medals.length ? medals.map((medal) => `<span class="garage-medal">${medal}</span>`).join('') : '<span class="garage-empty">No medals yet</span>'}</div>
    `;

    container.appendChild(card);
  });
}

function renderGhostTargets(progress) {
  const container = document.getElementById('garage-time-attack');
  if (!container) return;

  const verifiedTrackIds = ['map1', 'map2'];
  container.innerHTML = '';

  verifiedTrackIds.forEach((trackId) => {
    const targets = resolveTimeAttackTargets(trackId);
    const best = progress?.timeAttack?.[trackId];
    const trackLabel = ALL_TRACKS[trackId]?.label || trackId;

    const card = document.createElement('div');
    card.className = 'garage-record-card';
    card.innerHTML = `
      <div class="garage-record-top">
        <strong>${trackLabel}</strong>
        <span>${best?.medal ? `${best.medal} medal` : 'No medal yet'}</span>
      </div>
      <div class="garage-record-times">
        <span>S ${formatRaceTime(targets.s)}</span>
        <span>A ${formatRaceTime(targets.a)}</span>
        <span>B ${formatRaceTime(targets.b)}</span>
      </div>
      <div class="garage-record-best">Best: ${formatRaceTime(Number(best?.bestTimeMs || 0))}</div>
    `;
    container.appendChild(card);
  });
}

function attachEvents() {
  const resetBtn = document.getElementById('reset-progress-btn');
  if (!resetBtn) return;

  resetBtn.addEventListener('click', () => {
    const confirmed = window.confirm('Reset all single-player cups and time attack records?');
    if (!confirmed) return;
    localStorage.removeItem('singlePlayerProgress');
    const fresh = readProgressState();
    renderSummary(fresh);
    renderCupCabinet(fresh);
    renderGhostTargets(fresh);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const progress = readProgressState();
  renderSummary(progress);
  renderCupCabinet(progress);
  renderGhostTargets(progress);
  attachEvents();
});