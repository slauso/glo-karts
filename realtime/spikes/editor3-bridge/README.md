# Editor3 → Multiplayer Bridge Spike (Phase 1.5)

## Why

Spike A (`spikes/cannon-es/`) proved the cannon-es physics engine is fast
enough to run server-side at 8 karts / 60 Hz. This spike answers the next
question: **can we wrap that physics in a Colyseus room and get a real,
input-driven, schema-replicated round trip?**

## What's here

- `server.mjs` — standalone Colyseus server on port 2568 with one room
  (`Editor3BridgeRoom`) that owns a cannon-es world, accepts `input` messages,
  ticks at 60 Hz, and writes `KartState` into the room state at 20 Hz.
- `smoke-client.mjs` — synthetic Node clients that join the room, fire pulsed
  throttle + steering inputs, listen for state updates, and print pass/fail.

## Run

```powershell
# Terminal 1
cd realtime
node spikes/editor3-bridge/server.mjs --port=2568

# Terminal 2
node spikes/editor3-bridge/smoke-client.mjs --clients=8 --duration=10
```

Args: `--port`, `--hz` (server), `--snapshot-hz` (server),
`--clients`, `--duration`, `--input-hz`, `--endpoint` (client).

## Out of scope (intentional)

- Client-side prediction + reconciliation (smoke client just records what
  it receives — does not simulate locally).
- Lag compensation / rewind buffer.
- Weapons, pickups, hit detection (see `realtime/src/combat-runtime.js`).
- Track JSON ingestion — uses the spike-A 6×6 tile world.
- Browser client — Node smoke client is enough to prove the protocol.

See `RESULTS.md` for outcome and gaps to production.
