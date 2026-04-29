// pickup-runtime-smoke.mjs — Node-only validation of combat-runtime.js.
// Verifies that buildCombatState + sweepKart + tickRespawns enforce:
//   1. A pickup fires exactly once per kart sweep within its radius.
//   2. After firing, the pickup is unavailable until respawnMs elapses.
//   3. tickRespawns re-arms cooled-down pickups.
//   4. Effect overlays fire repeatedly (no respawn cooldown), but the
//      caller's debounce still works (combat-runtime itself does not
//      debounce — that's the play-layer's job).
//   5. Karts outside the trigger radius see no events.
//
// Loaded directly via dynamic import — does not require the browser.
import { Track } from '../src/editor3/track-data.js';
import {
  buildCombatState, sweepKart, tickRespawns, withinTrigger,
} from '../src/editor3/combat-runtime.js';

let fails = 0;
const log = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) fails++;
};

// ── Build a track with one road row and three overlays.
const t = new Track();
t.place('straight', 0, 0, 0);
t.place('straight', 0, 1, 0);
t.place('straight', 0, 2, 0);
const itemBox = t.place('item_box', 0, 0, 0);
const boost   = t.place('boost_pad', 0, 1, 0);
const oil     = t.place('oil_slick', 0, 2, 0);
log(itemBox && boost && oil, `placed 3 overlays on 3 road tiles`);

const state = buildCombatState(t.all());
log(state.size === 3, `combat state size: ${state.size}`);

// World coords: world tile = TILE_segment_metres * WORLD_UNITS_PER_M = 12 * 1000.
const TILE_W = 12 * 1000;

// ── 1. Standing on the item box → pickup event fires.
const ev1 = sweepKart(state, 0, 0, 1000);
log(ev1.length === 1 && ev1[0].type === 'pickup' && ev1[0].payload === 'weapon_random',
  `item_box pickup fires: ${JSON.stringify(ev1)}`);

// ── 2. Immediately again → no event (consumed).
const ev2 = sweepKart(state, 0, 0, 1100);
log(ev2.length === 0, `item_box no re-fire while cooling down (events=${ev2.length})`);

// ── 3. Far away → no events at all.
const ev3 = sweepKart(state, TILE_W * 5, TILE_W * 5, 1200);
log(ev3.length === 0, `outside trigger: ${ev3.length} events`);

// ── 4. tick respawn before respawnMs → still cold.
const r1 = tickRespawns(state, 1000 + 1000); // respawnMs default 4000
log(r1.length === 0, `not yet respawned at +1000ms (got ${r1.length})`);

// ── 5. tick respawn after respawnMs → re-armed and re-collectible.
const r2 = tickRespawns(state, 1000 + 5000);
log(r2.length === 1 && r2[0].id === itemBox.id, `respawned at +5000ms: ${JSON.stringify(r2)}`);
const ev4 = sweepKart(state, 0, 0, 1000 + 5100);
log(ev4.length === 1 && ev4[0].type === 'pickup', `re-collected after respawn: ${ev4.length}`);

// ── 6. Boost pad: fires on every sweep (no respawn).
const ev5 = sweepKart(state, 0, TILE_W, 2000);
const ev6 = sweepKart(state, 0, TILE_W, 2010);
log(ev5.length === 1 && ev5[0].type === 'effect' && ev5[0].effect === 'boost',
  `boost pad event: ${JSON.stringify(ev5)}`);
log(ev6.length === 1 && ev6[0].effect === 'boost',
  `boost pad re-fires every sweep (events=${ev6.length})`);

// ── 7. Oil slick fires its effect at z = TILE_W * 2.
const ev7 = sweepKart(state, 0, TILE_W * 2, 3000);
log(ev7.length === 1 && ev7[0].effect === 'oil', `oil slick: ${JSON.stringify(ev7)}`);

// ── 8. withinTrigger sanity: cell-centre vs cell-edge.
log(withinTrigger(0, 0, 0, 0, TILE_W * 0.45) === true, `inside radius`);
log(withinTrigger(TILE_W, 0, 0, 0, TILE_W * 0.45) === false, `outside radius`);

console.log(`\n${fails === 0 ? '✓ ALL CLEAN' : `✗ ${fails} failures`}`);
process.exit(fails === 0 ? 0 : 1);
