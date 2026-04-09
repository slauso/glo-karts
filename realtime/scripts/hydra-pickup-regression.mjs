import { BattleRoom } from '../src/rooms/BattleRoom.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createFakeClient(sessionId) {
  const sent = [];
  return {
    sessionId,
    sent,
    send(type, payload) {
      sent.push({ type, payload });
    },
  };
}

function getItemBoxes(room) {
  const boxes = [];
  room.state.entities.forEach((entity) => {
    if (entity.type === 'item_box') boxes.push(entity);
  });
  return boxes;
}

const room = new BattleRoom();
room.listing = { metadata: {} };
room.roomId = 'hydra-pickup-regression';
room.onCreate({
  gameType: 'deathmatch',
  scoreLimit: 5,
  trackId: 'glo_arena',
  weaponPool: ['crimson_hydra'],
});

const client = createFakeClient('hydra-host');
room.onJoin(client, { playerName: 'Hydra Host' });

const player = room.state.players.get(client.sessionId);
const boxes = getItemBoxes(room);
const rolls = [];

for (const box of boxes.slice(0, 4)) {
  player.weapon2 = '';
  player.ammo2 = 0;
  player.weapon3 = '';
  player.ammo3 = 0;
  box.active = true;
  box.respawnTimer = 0;
  player.x = box.x;
  player.y = box.y;
  player.z = box.z;

  const result = room._handlePickupItem(client, {
    entityId: box.id,
    x: box.x,
    y: box.y,
    z: box.z,
  });

  assert(result, `Expected pickup result for ${box.id}`);
  assert(result.weapon === 'crimson_hydra', `Expected Hydra grant from ${box.id}, got ${result.weapon}`);
  assert(result.slot === 'secondary', `Expected secondary slot grant from ${box.id}`);
  assert(player.weapon2 === 'crimson_hydra', `Expected player secondary weapon Hydra after ${box.id}`);
  assert(player.ammo2 === 1, `Expected Hydra ammo of 1 after ${box.id}`);
  assert(box.active === false, `Expected ${box.id} to deactivate after pickup`);
  assert(box.respawnTimer === 10000, `Expected ${box.id} respawn timer to be set`);
  rolls.push(result.weapon);
}

const itemReceivedPayloads = client.sent.filter((entry) => entry.type === 'itemReceived').map((entry) => entry.payload.weapon);

assert(rolls.length === 4, 'Expected four deterministic pickup rolls');
assert(rolls.every((weaponId) => weaponId === 'crimson_hydra'), 'Every authoritative pickup roll should be Hydra');
assert(itemReceivedPayloads.length === 4, 'Expected four itemReceived messages');
assert(itemReceivedPayloads.every((weaponId) => weaponId === 'crimson_hydra'), 'Every itemReceived message should announce Hydra');

console.log('HYDRA_PICKUP_REGRESSION', JSON.stringify({
  ok: true,
  summary: {
    weaponPool: room._weaponPool,
    rolls,
    itemReceivedPayloads,
    itemBoxCount: boxes.length,
  },
}, null, 2));
process.exit(0);