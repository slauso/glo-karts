/**
 * fps-hud.js — DOM-based HUD for the Arena FPS mode.
 * Drives crosshair, ammo, score, reload bar, hit-marker, and damage flash.
 */

const $ = (id) => document.getElementById(id);

export function initHUD() {
  const els = {
    ammoCurrent:  $('ammo-current'),
    ammoMax:      $('ammo-max'),
    weaponName:   $('weapon-name'),
    reloadBar:    $('reload-bar'),
    reloadFill:   $('reload-fill'),
    scoreValue:   $('score-value'),
    hitValue:     $('hit-value'),
    healthValue:  $('health-value'),
    healthFill:   $('health-fill'),
    hitMarker:    $('hit-marker'),
    damageFlash:  $('damage-flash'),
    slots:        [0, 1, 2].map(i => $('slot-' + i)),
  };

  let hitMarkerTimer = 0;
  let damageTimer = 0;

  return {
    updateAmmo({ current, max }) {
      if (els.ammoCurrent) els.ammoCurrent.textContent = current;
      if (els.ammoMax) els.ammoMax.textContent = max;
    },

    updateScore(score, hits) {
      if (els.scoreValue) els.scoreValue.textContent = score;
      if (els.hitValue) els.hitValue.textContent = hits;
    },

    updateWeaponName(name) {
      if (els.weaponName) els.weaponName.textContent = name;
    },

    updateWeaponSlot(index) {
      els.slots.forEach((s, i) => {
        if (s) s.classList.toggle('active', i === index);
      });
    },

    updateHealth(pct) {
      if (els.healthFill) els.healthFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      if (els.healthValue) els.healthValue.textContent = Math.round(Math.max(0, Math.min(100, pct)));
    },

    showReloading(progress) {
      if (els.reloadBar) {
        els.reloadBar.style.display = progress < 1 ? 'block' : 'none';
        els.reloadFill.style.width = (progress * 100) + '%';
      }
    },

    showHitMarker() {
      if (els.hitMarker) {
        els.hitMarker.classList.add('show');
        clearTimeout(hitMarkerTimer);
        hitMarkerTimer = setTimeout(() => els.hitMarker.classList.remove('show'), 200);
      }
    },

    showDamageFlash() {
      if (els.damageFlash) {
        els.damageFlash.classList.add('show');
        clearTimeout(damageTimer);
        damageTimer = setTimeout(() => els.damageFlash.classList.remove('show'), 250);
      }
    },
  };
}
