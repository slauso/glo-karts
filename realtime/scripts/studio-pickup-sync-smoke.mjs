// studio-pickup-sync-smoke.mjs — Two-client authoritative-pickup smoke for StudioRoom.
// Spawns the room in-process, attaches two fake clients, encodes a track with
// a single item_box, then drives client-A onto it. Asserts:
//   • Both clients receive a single `pickupGrant` for client-A.
//   • The associated `pickupUpdate` flips ready→false for both.
//   • After respawn timer elapses, both receive `pickupUpdate` with ready→true.
//   • Late-joining client-C receives `combatInit` with the current snapshot.
import { StudioRoom } from '../src/rooms/StudioRoom.js';
import { Track, encodeTrack } from '../../frontend/src/editor3/track-data.js';

function fakeClient(sessionId) {
  const inbox = [];
  return {
    sessionId,
    inbox,
    send(type, payload) { inbox.push({ type, payload }); },
  };
}

let fails = 0;
const log = (ok, label) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) fails++; };

// ── Build the track: one straight + one item_box on top.
const track = new Track();
track.place('straight', 0, 0, 0);
const box = track.place('item_box', 0, 0, 0);
const code = encodeTrack(track);
log(!!box && code.length > 0, `encoded track with item_box (id=${box.id}, code=${code.length}B)`);

// ── Stand up the room with that track.
const room = new StudioRoom();
// Stub the parts of Colyseus.Room we touch so onCreate runs cleanly.
const intervals = [];
let nextHandle = 1;
room.setSimulationInterval = () => nextHandle++;   // we drive sweeps manually
room.broadcast = (type, payload, opts) => {
  for (const c of room._fakeClients || []) {
    if (opts?.except && c.sessionId === opts.except.sessionId) continue;
    c.send(type, payload);
  }
};
room.clock = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
room.onCreate({ track: code });
log(room.combat.size === 1, `combat state size: ${room.combat.size}`);

const entity = Array.from(room.combat.values())[0];
log(entity.kind === 'pickup' && entity.key === 'item_box', `entity is pickup item_box`);

// ── Two clients join.
const A = fakeClient('A'); const B = fakeClient('B');
room._fakeClients = [A, B];
room.onJoin(A, { name: 'A' });
room.onJoin(B, { name: 'B' });
log(room.peers.size === 2, `peers joined: ${room.peers.size}`);

// Both should have received trackData and combatInit (after both joined,
// only B receives combatInit since A joined while combat already existed —
// _broadcastCombatInit(client) is called per-client).
const aTrack = A.inbox.find(m => m.type === 'trackData');
const bInit  = B.inbox.find(m => m.type === 'combatInit');
log(!!aTrack, `client A received trackData`);
log(!!bInit && bInit.payload.pickups.length === 1, `client B received combatInit with 1 pickup`);

// ── Drive client A onto the pickup. Inject the transform straight onto the peer
// then run one sweep tick by simulating the body of the combat interval.
room.peers.get('A').transform = { x: entity.worldX, z: entity.worldZ, y: 0,
  qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, t: Date.now() };

function combatTick(now = Date.now()) { /* unused — see runCombatLoop below */ }
// Easier: import sweepKart directly and re-run the loop body.
const { sweepKart, tickRespawns } = await import('../../frontend/src/editor3/combat-runtime.js');

function runCombatLoop(now) {
  for (const [sid, peer] of room.peers) {
    if (!peer.transform) continue;
    const events = sweepKart(room.combat, peer.transform.x, peer.transform.z, now);
    for (const ev of events) {
      if (ev.type === 'pickup') {
        room.broadcast('pickupGrant', { id: ev.id, sessionId: sid, payload: ev.payload, amount: ev.amount });
        const ent = room.combat.get(ev.id);
        if (ent) room.broadcast('pickupUpdate', { id: ent.id, ready: ent.ready, respawnAt: ent.respawnAt });
      } else if (ev.type === 'effect') {
        room.broadcast('effectFired', { id: ev.id, sessionId: sid, effect: ev.effect, strength: ev.strength, durationMs: ev.durationMs });
      }
    }
  }
}
function runRespawnLoop(now) {
  const ready = tickRespawns(room.combat, now);
  for (const r of ready) {
    const ent = room.combat.get(r.id);
    if (ent) room.broadcast('pickupUpdate', { id: ent.id, ready: true, respawnAt: 0 });
  }
}

const t0 = 1_000_000;
A.inbox.length = 0; B.inbox.length = 0;
runCombatLoop(t0);

const aGrants = A.inbox.filter(m => m.type === 'pickupGrant');
const bGrants = B.inbox.filter(m => m.type === 'pickupGrant');
log(aGrants.length === 1 && aGrants[0].payload.sessionId === 'A',
  `A got 1 pickupGrant for A: ${JSON.stringify(aGrants)}`);
log(bGrants.length === 1 && bGrants[0].payload.sessionId === 'A',
  `B got 1 pickupGrant for A: ${JSON.stringify(bGrants)}`);

const aUpdates = A.inbox.filter(m => m.type === 'pickupUpdate');
const bUpdates = B.inbox.filter(m => m.type === 'pickupUpdate');
log(aUpdates.length === 1 && aUpdates[0].payload.ready === false, `A got pickupUpdate ready=false`);
log(bUpdates.length === 1 && bUpdates[0].payload.ready === false, `B got pickupUpdate ready=false`);

// ── Second sweep immediately: nothing should grant (cooling down).
A.inbox.length = 0; B.inbox.length = 0;
runCombatLoop(t0 + 50);
log(A.inbox.filter(m => m.type === 'pickupGrant').length === 0, `no double-grant during cooldown`);

// ── Respawn after 4000ms.
runRespawnLoop(t0 + 4500);
const aRespawn = A.inbox.find(m => m.type === 'pickupUpdate' && m.payload.ready === true);
const bRespawn = B.inbox.find(m => m.type === 'pickupUpdate' && m.payload.ready === true);
log(!!aRespawn && !!bRespawn, `A and B both received pickupUpdate ready=true after respawn`);

// ── Late joiner C should receive combatInit.
const C = fakeClient('C');
room._fakeClients.push(C);
room.onJoin(C, { name: 'C' });
const cInit = C.inbox.find(m => m.type === 'combatInit');
log(!!cInit && cInit.payload.pickups.length === 1, `late joiner C received combatInit`);
log(cInit.payload.pickups[0].ready === true, `late joiner sees pickup as ready (post-respawn)`);

console.log(`\n${fails === 0 ? '✓ ALL CLEAN' : `✗ ${fails} failures`}`);
process.exit(fails === 0 ? 0 : 1);
