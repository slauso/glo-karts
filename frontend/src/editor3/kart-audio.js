/**
 * kart-audio.js — Web Audio kart sound rig.
 *
 * Loads a per-kart sound bank from /audio/kart-sfx/ and exposes a
 * lightweight per-frame state-driven update plus one-shot playback.
 *
 * Engine model
 *   We compute a synthetic RPM in [0,1] from the kart's ground speed
 *   and throttle pedal, then crossfade two loops — IDLE and RUN —
 *   across a narrow band so only one voice dominates at any time.
 *   The DASH loop is held silent during normal driving and only
 *   ducks RUN out / DASH in while a boost is actually active, so the
 *   listener never hears two engine recordings beating against each
 *   other. A SKID loop runs in parallel, gated on drift-active OR
 *   burnout-charge (wheelspin).
 *
 * Tire / road feel
 *   ROAD — a synthesized pink-noise rumble (lowpass + bandpass) whose
 *     gain and pitch scale with ground speed. Gives the kart a sense
 *     of "rolling on a surface" without needing a dedicated clip.
 *     Mutes when airborne or stopped.
 *   SKID — the StartDushAndSkidd squeal loop, gain proportional to
 *     a `slip` intensity that is the max of three sources:
 *       • drift slide (handbrake + steering)
 *       • hard brake at speed
 *       • lateral side-slip (wheels not following heading)
 *     A short scrub chirp also fires on hard-brake onset.
 *
 * One-shots
 *   start  — race-start "AccelBeforeStart" gunning the throttle
 *   miniTurbo — short blip on a drift-tier release
 *   dashStop — shut-down sigh on boost end
 *   explode — engine-bay rupture
 *   horn    — player horn (KeyH in the playtest)
 *
 * Bank layout
 *   /audio/kart-sfx/<BANK>/<file>.ogg — see frontend/public/audio/kart-sfx/.
 *   The default bank is `K_Std` because it has all nine logical clips
 *   in one folder under intuitive names. Other banks (`pSE_EG_*`)
 *   can be wired through the `kit` option.
 */

const SFX_BASE = '/audio/kart-sfx/';

// Logical event → file path within /audio/kart-sfx/. The default
// "stock" kit pulls from K_Std, the only bank that ships every clip
// we need with friendly names.
export const STD_KIT = {
  idle:      'K_Std/idle_NoiseReduction.b.32.ogg',
  run:       'K_Std/AccelNormal.ry.32.ogg',
  dash:      'K_Std/DashEngine.ry.32.ogg',
  miniTurbo: 'K_Std/DashEngineMiniTurbo.ry.32.ogg',
  dashStop:  'K_Std/DashEngineStop.ry.32.ogg',
  explode:   'K_Std/EngineExplosion.ry.32.ogg',
  // Engine-overload replacement layers — sourced from /audio/sfx/
  // (resolved via a `../sfx/` traversal off SFX_BASE). The K_Std
  // EngineExplosion clip alone read as glitchy on top of the burnout
  // bed; layering a dull thud + a longer rumble gives the rupture
  // the weight the cartoon clip lacks.
  overloadBlast: '../sfx/explosion.ogg',
  overloadCrash: '../sfx/crash.ogg',
  start:     'K_Std/AccelBeforeStart.q.32.ogg',
  skid:      'K_Std/StartDushAndSkidd.ry.32.ogg',
  horn:      'K_Std/pSE_HORN_K_STD.ogg',
};

// V8 muscle-car kits sourced from the Vigilante 8: 2nd Offense Unity port
// (https://github.com/stefanvranjes/Vigilante2Unity, assets cleared for
// reuse). The original PSX banks are short PCM loops (7–11 kHz, mono).
// Index→role mapping inferred from sample-rate/length conventions:
//   _0000 = longest, highest SR → low-rev loop
//   _0001 = mid-rev loop        → run
//   _0004 = sustained high loop → dash (TBOLT/STINGER only)
//   _0003 = top-end             → fallback dash for CORSAIR
// The V8 `_0000` clips are low-rev "engine running" loops, not true
// idles, but the K_Std `idle_NoiseReduction` recording has a vocal
// artifact buried in it that's audible as a quiet repeating loop.
// We use the V8 sample for idle and tune the engine profile (see
// V8_ENGINE_PROFILE below) to pitch it down + keep the pitch sweep
// mostly flat in the idle band, so it reads as a chugging V8 idle
// rather than a revved-up engine. The V8 run sample then crossfades
// in early (~30 % RPM) so the idle sample only really matters at a
// standstill / coasting where its detuned chug is appropriate.
// Non-engine slots (horn, skid, explode, etc.) fall back to K_Std
// files because the V8 banks only contain engine layers.
export const V8_TBOLT_KIT = {
  idle:      'V8_TBolt/TBOLT_0000.ogg',
  // Run sample sourced from K_Std (not the V8 bank) because every V8
  // bank's mid-rev clip contains audible spoken phrases from the PSX
  // recording session that loop distractingly when the throttle is
  // held. Spacebar+W (burnout charge) sounds clean because that
  // state uses a drift-lock branch which mutes the run loop and
  // plays only idle.
  run:       'K_Std/AccelNormal.ry.32.ogg',
  dash:      'V8_TBolt/TBOLT_0004.ogg',
  miniTurbo: 'K_Std/DashEngineMiniTurbo.ry.32.ogg',
  dashStop:  'K_Std/DashEngineStop.ry.32.ogg',
  explode:   'K_Std/EngineExplosion.ry.32.ogg',
  overloadBlast: '../sfx/explosion.ogg',
  overloadCrash: '../sfx/crash.ogg',
  start:     'K_Std/AccelBeforeStart.q.32.ogg',
  skid:      'K_Std/StartDushAndSkidd.ry.32.ogg',
  horn:      'K_Std/pSE_HORN_K_STD.ogg',
};

export const V8_STINGER_KIT = {
  idle:      'V8_Stinger/STINGER_0002.ogg',
  run:       'K_Std/AccelNormal.ry.32.ogg',
  dash:      'V8_Stinger/STINGER_0005.ogg',
  miniTurbo: 'K_Std/DashEngineMiniTurbo.ry.32.ogg',
  dashStop:  'K_Std/DashEngineStop.ry.32.ogg',
  explode:   'K_Std/EngineExplosion.ry.32.ogg',
  overloadBlast: '../sfx/explosion.ogg',
  overloadCrash: '../sfx/crash.ogg',
  start:     'K_Std/AccelBeforeStart.q.32.ogg',
  skid:      'K_Std/StartDushAndSkidd.ry.32.ogg',
  horn:      'K_Std/pSE_HORN_K_STD.ogg',
};

export const V8_CORSAIR_KIT = {
  idle:      'V8_Corsair/CORSAIR_0002.ogg',
  run:       'K_Std/AccelNormal.ry.32.ogg',
  dash:      'V8_Corsair/CORSAIR_0001.ogg',
  miniTurbo: 'K_Std/DashEngineMiniTurbo.ry.32.ogg',
  dashStop:  'K_Std/DashEngineStop.ry.32.ogg',
  explode:   'K_Std/EngineExplosion.ry.32.ogg',
  overloadBlast: '../sfx/explosion.ogg',
  overloadCrash: '../sfx/crash.ogg',
  start:     'K_Std/AccelBeforeStart.q.32.ogg',
  skid:      'K_Std/StartDushAndSkidd.ry.32.ogg',
  horn:      'K_Std/pSE_HORN_K_STD.ogg',
};

// Plymouth-style muscle car (Caravelle) — fourth V8 option. The bank
// has 7 numbered clips (0000-0006); 0006 is a 48 kHz stereo outlier
// likely captured as a horn/oneshot rather than an engine loop, so we
// skip it. We pick mid-numbered clips for engine-only stems.
export const V8_CARAVELLE_KIT = {
  idle:      'V8_Caravelle/CARAVLLE_0002.ogg',
  run:       'K_Std/AccelNormal.ry.32.ogg',
  dash:      'V8_Caravelle/CARAVLLE_0004.ogg',
  miniTurbo: 'K_Std/DashEngineMiniTurbo.ry.32.ogg',
  dashStop:  'K_Std/DashEngineStop.ry.32.ogg',
  explode:   'K_Std/EngineExplosion.ry.32.ogg',
  overloadBlast: '../sfx/explosion.ogg',
  overloadCrash: '../sfx/crash.ogg',
  start:     'K_Std/AccelBeforeStart.q.32.ogg',
  skid:      'K_Std/StartDushAndSkidd.ry.32.ogg',
  horn:      'K_Std/pSE_HORN_K_STD.ogg',
};

// Registry for runtime kit selection. Pick via createKartAudio({ kit: V8_KITS.tbolt }).
export const V8_KITS = {
  tbolt:     V8_TBOLT_KIT,
  stinger:   V8_STINGER_KIT,
  corsair:   V8_CORSAIR_KIT,
  caravelle: V8_CARAVELLE_KIT,
};

// ── Engine voice profile ───────────────────────────────────────────
// Per-kit tuning for how the sample loops + synth buzz are mapped to
// RPM/throttle. The K_Std bank is a 32 kHz studio recording that can
// be pitched across a wide range without falling apart, so its
// profile keeps the original (0.65 → 2.65) idle sweep and full synth
// buzz contribution. The V8 banks are 7–11 kHz PSX-era PCM mono;
// pitching them past ~2.2× starts to alias and the V8 recordings
// already carry their own harmonic content, so the V8 profile uses a
// narrower pitch sweep, brings the run/dash sample loops in earlier
// (V8s have their character in the mid-rev band, not just at
// redline), and trims the synth buzz so the recorded timbre wins.
export const STD_ENGINE_PROFILE = {
  idleRateBase: 0.65, idleRateRpm: 2.00,   // 0.65 → 2.65
  runRateBase:  0.95, runRateRpm:  0.75,   // 0.95 → 1.70
  dashRateBase: 0.85, dashRateRpm: 0.70,   // 0.85 → 1.55
  // Where the run sample crossfades in (RPM smoothstep range).
  runEnterStart: 0.70, runEnterEnd: 0.95,
  // Where the "top-end" curve activates (boosts run gain, buzz cutoff,
  // buzz fundamental).
  topEndStart:   0.78, topEndEnd:   1.00,
  // Multiplier applied to the synth-buzz gain so V8 kits can push
  // the recorded engine forward and the synth backward.
  buzzMultiplier: 1.0,
  // Multiplier applied to the run-loop sample gain. K_Std uses the
  // run loop as a subtle high-RPM harmonic layer (1.0); V8 kits push
  // it up because the run sample IS the V8's main character voice.
  runGainMultiplier: 1.0,
  // When true, the recorded idle/run/dash sample loops are silenced
  // and the engine relies on the synth-buzz voice alone. V8 kits use
  // this because their PSX-era samples can contain vocal/radio
  // artifacts that loop distractingly.
  sampleEngineMuted: false,
};
export const V8_ENGINE_PROFILE = {
  // Recorded samples enabled — these B_* banks are pure kart engine
  // recordings, no voice contamination.
  sampleEngineMuted: false,
  // The B_* banks are recorded at native kart-engine pitch (high-rev
  // 2- and 4-stroke). To get a V8-rumble character we pitch them
  // DOWN aggressively at idle (0.40 + 0.18·1.20 ≈ 0.62×) and only
  // open them up modestly with rpm. Going below ~0.45× starts to
  // expose the loop seam, so the floor is conservative.
  idleRateBase: 0.40, idleRateRpm: 1.20,   // 0.62 (idle) → 1.60 (redline)
  // Run loop also pitched down to keep the V8 character through the
  // mid powerband; tops out near native pitch at flat-out.
  runRateBase:  0.55, runRateRpm:  0.45,   // 0.55 → 1.00
  dashRateBase: 0.65, dashRateRpm: 0.40,   // 0.65 → 1.05
  // Crossfade the run loop in early so the heavier B_BIG-style loop
  // takes over the moment the player gets on the throttle.
  runEnterStart: 0.30, runEnterEnd: 0.65,
  topEndStart:   0.55, topEndEnd:   0.92,
  // Synth buzz back to a supporting role — recorded engine carries
  // the character; synth provides instant throttle response.
  buzzMultiplier: 0.40,
  // Run sample is the primary voice once crossfaded in.
  runGainMultiplier: 2.0,
};
// Attach a profile to each V8 kit so createKartAudio can pick it up
// automatically without the caller having to wire profiles by hand.
// The `_*` prefix marks the field as metadata (not a file path) so
// the loader skips it.
V8_TBOLT_KIT._profile   = V8_ENGINE_PROFILE;
V8_STINGER_KIT._profile = V8_ENGINE_PROFILE;
V8_CORSAIR_KIT._profile = V8_ENGINE_PROFILE;
V8_CARAVELLE_KIT._profile = V8_ENGINE_PROFILE;

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x, a, b) {
  if (b <= a) return x >= a ? 1 : 0;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function makeNullAudio() {
  return {
    update() {}, playOneShot() {}, setMasterVolume() {},
    ctx: null, get ready() { return false; },
  };
}

/**
 * Create a kart audio rig.
 *
 * @param {object} opts
 * @param {Record<string,string>} [opts.kit]      Logical-name → file
 *   map within /audio/kart-sfx/. Defaults to STD_KIT.
 * @param {number} [opts.masterVolume]            0..1.
 * @returns {{
 *   update(state: {
 *     speed: number, throttle: number, grounded?: boolean,
 *     lateralSpeed?: number, braking?: boolean,
 *     drifting?: boolean, charging?: boolean, boosting?: boolean,
 *     exploded?: boolean,
 *   }): void,
 *   playOneShot(name: string, opts?: { gain?: number, rate?: number }): void,
 *   setMasterVolume(v: number): void,
 *   ctx: AudioContext | null,
 *   readonly ready: boolean,
 * }}
 */
export function createKartAudio({ kit = STD_KIT, masterVolume = 0.7 } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return makeNullAudio();

  // Per-kit engine voice tuning. Kits may attach a `_profile` field to
  // override the default mapping (V8 kits do this so their lo-SR PCM
  // recordings don't get pitched into chipmunk territory).
  const profile = (kit && kit._profile) || STD_ENGINE_PROFILE;

  const ctx = new Ctx({ latencyHint: 'interactive' });
  const masterGain = ctx.createGain();
  masterGain.gain.value = masterVolume;
  masterGain.connect(ctx.destination);

  // Decoded buffers keyed by logical name.
  const buffers = {};
  let ready = false;

  Promise.all(Object.entries(kit).map(async ([name, rel]) => {
    // Skip metadata fields (e.g. `_profile`) — only string entries are
    // file paths to fetch + decode.
    if (name.startsWith('_') || typeof rel !== 'string') return;
    try {
      const res = await fetch(SFX_BASE + rel);
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      const ab = await res.arrayBuffer();
      buffers[name] = await ctx.decodeAudioData(ab);
    } catch (err) {
      console.warn(`[kart-audio] failed to load ${name} (${rel}):`, err.message);
    }
  })).then(() => { ready = true; });

  // Browser autoplay policy — AudioContext starts suspended until a
  // user gesture. Resume on the first pointer/keyboard input then
  // detach the listeners.
  const resume = () => {
    if (ctx.state === 'suspended') ctx.resume();
    window.removeEventListener('pointerdown', resume, true);
    window.removeEventListener('keydown', resume, true);
  };
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown', resume, true);

  // Per-loop voice cache. Each entry: { src, gain }.
  const loops = {};
  function startLoop(name) {
    if (loops[name] || !buffers[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(masterGain);
    src.start();
    loops[name] = { src, gain: g };
  }
  function setLoopGain(name, value, ramp = 0.06) {
    const v = loops[name];
    if (!v) return;
    v.gain.gain.setTargetAtTime(value, ctx.currentTime, ramp);
  }
  function setLoopRate(name, rate, ramp = 0.06) {
    const v = loops[name];
    if (!v) return;
    v.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, ramp);
  }

  // Active one-shot voices keyed by logical name. Each entry tracks the
  // last BufferSource + gain + start time so we can:
  //   1. Stop and disconnect a prior instance before playing a new one
  //      of the same name (prevents stacked miniTurbo blips when the
  //      drift tier ticks T1 → T2 → T3 in rapid succession).
  //   2. Enforce a per-name minimum interval to debounce edge-triggered
  //      events (e.g. a flickering boost edge causing rapid dashStop).
  const activeOneShots = new Map();
  // Per-name minimum interval (seconds) between successive one-shots.
  // Defaults to 0.18 s; named entries below override for clips that are
  // legitimately spammed (start gun, horn).
  const ONESHOT_COOLDOWN = {
    miniTurbo: 0.18,
    dashStop:  0.30,
    explode:   1.50,
    overloadBlast: 1.50,
    overloadCrash: 1.50,
    horn:      0.10,
    start:     0.50,
    skid:      0.20,
  };
  // Names of one-shots that are suppressed while the kart is in a
  // sustained drift / charge state. miniTurbo fires once per drift
  // tier ramp-up (T1 → T2 → T3) and dashStop fires on every boost
  // edge; both blip on top of the persistent squeal + engine bed and
  // are the chief source of the "start/stopping sounds during drift"
  // the player hears. While `_driftSuppress` is set in update() the
  // playOneShot path silently drops these names.
  const DRIFT_SUPPRESSED_ONESHOTS = new Set(['miniTurbo', 'dashStop']);
  function playOneShot(name, { gain = 1, rate = 1 } = {}) {
    const buf = buffers[name];
    if (!buf) return;
    if (playOneShot._driftSuppress && DRIFT_SUPPRESSED_ONESHOTS.has(name)) return;
    const now = ctx.currentTime;
    const prev = activeOneShots.get(name);
    if (prev) {
      // Cooldown gate — refuse retriggers within the per-name window so
      // stacking edges don't pile on overlapping copies of the same clip.
      const cd = ONESHOT_COOLDOWN[name] ?? 0.15;
      if (now - prev.startedAt < cd) return;
      // Otherwise fade-cut the previous voice. A 30 ms fade avoids a
      // click but is short enough that the new clip starts cleanly on
      // top of silence.
      try {
        prev.gain.gain.cancelScheduledValues(now);
        prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
        prev.gain.gain.linearRampToValueAtTime(0, now + 0.030);
        prev.src.stop(now + 0.035);
      } catch { /* source already ended */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(masterGain);
    src.start();
    const entry = { src, gain: g, startedAt: now };
    activeOneShots.set(name, entry);
    src.onended = () => {
      if (activeOneShots.get(name) === entry) activeOneShots.delete(name);
      try { g.disconnect(); } catch {}
    };
  }

  let started = false;
  // Synthesized road-rumble voice. Built lazily on first ensureLoopsStarted()
  // because BufferSource and BiquadFilter need an unsuspended context to
  // sound clean. Stored separately from `loops` because its source isn't
  // a decoded buffer from the SFX bank.
  let road = null;
  // Synthesized engine "buzz" voice. The sample loops alone don't track
  // the kart's powerband convincingly — a recorded engine is a single
  // pitch and pitching it via playbackRate sounds artificial when the
  // ratio strays far from 1. We add a sawtooth oscillator whose pitch
  // is driven directly by RPM and whose gain/filter cutoff are driven
  // by throttle. This gives the engine a continuous, instant-response
  // "BRAAAP" character that follows what the player is doing in real
  // time, while the idle sample carries the recorded grit underneath.
  let engineBuzz = null;
  // Synthesized authentic tire-squeal voice. The bundled skid clip is a
  // cartoon "wheee", which doesn't read as rubber on asphalt. A pair of
  // high-Q resonant bandpass filters fed by white noise — with one
  // anchored ~1.7 kHz and the second a subtle harmonic above it — gives
  // a much more realistic rubber-scrub timbre. A slow LFO on the centre
  // frequency adds the natural pitch wobble of a sliding tire.
  let squeal = null;
  function buildRoadVoice() {
    // Two seconds of pink-ish noise (white noise low-passed by averaging
    // — close enough to pink for a tire-rumble bed and avoids needing a
    // FFT). Two seconds is enough that the loop seam isn't audible
    // through the bandpass.
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      // 1-pole low-pass to tilt the spectrum toward pink.
      last = last * 0.92 + w * 0.08;
      data[i] = last;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Bandpass in the 80-400 Hz range gives the wheels-on-asphalt feel;
    // a follow-up lowpass kills any white-noise hiss on top.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 180;
    bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(lp).connect(g).connect(masterGain);
    src.start();
    road = { src, bp, lp, gain: g };
  }
  function buildSquealVoice() {
    const sr = ctx.sampleRate;
    // Use white noise (not pink) — squeal needs the high-frequency
    // energy that pink would attenuate. Two seconds, looped.
    const buf = ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // Highpass first to strip the rumble, then two stacked bandpasses:
    // a primary "fundamental" of the squeal and a quieter harmonic just
    // above it. Stacking gives a more complex, less synthetic timbre.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;

    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 1700;     // base squeal pitch
    bp1.Q.value = 14;               // high Q → resonant whistle

    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2550;     // ~harmonic
    bp2.Q.value = 18;

    // Mix the two bandpasses — bp1 dominant, bp2 a quieter overtone.
    const mix1 = ctx.createGain(); mix1.gain.value = 0.85;
    const mix2 = ctx.createGain(); mix2.gain.value = 0.40;

    // Final shaping: gentle lowpass to round off any remaining hiss
    // above the harmonic, plus the master squeal gain.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4500;
    const g = ctx.createGain();
    g.gain.value = 0;

    src.connect(hp);
    hp.connect(bp1).connect(mix1).connect(lp);
    hp.connect(bp2).connect(mix2).connect(lp);
    lp.connect(g).connect(masterGain);

    // LFO that wobbles both bandpass centre frequencies — real
    // sliding tires drift in pitch as the slip angle changes. ~5 Hz
    // sine, ±70 Hz on bp1 and ±100 Hz on bp2 (scales with frequency).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoGain1 = ctx.createGain(); lfoGain1.gain.value = 70;
    const lfoGain2 = ctx.createGain(); lfoGain2.gain.value = 100;
    lfo.connect(lfoGain1).connect(bp1.frequency);
    lfo.connect(lfoGain2).connect(bp2.frequency);
    lfo.start();

    src.start();
    squeal = { src, bp1, bp2, lp, gain: g, lfo };
  }

  function buildEngineBuzzVoice() {
    // Sawtooth fundamental — rich in harmonics, classic engine timbre.
    // Frequency is set per-frame in update() based on RPM. The osc
    // runs continuously; gain is what gates it audibly.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;

    // A slightly-detuned second sawtooth at the octave below adds
    // body and avoids the "thin synth lead" feel a single saw has.
    // Both share the same lowpass / gain chain so they track in sync.
    const oscSub = ctx.createOscillator();
    oscSub.type = 'sawtooth';
    oscSub.frequency.value = 30;
    oscSub.detune.value = -7;
    const subMix = ctx.createGain();
    subMix.gain.value = 0.45;

    // Lowpass with a moderate Q acts as the "throttle plate" — cutoff
    // opens dramatically as the player gets on the gas, which is what
    // creates the sense of the engine "opening up". At low throttle
    // the cutoff is near the fundamental so the harmonics are choked
    // off and the buzz is dull; at full throttle the cutoff opens to
    // ~2 kHz revealing the saw's full harmonic stack.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 250;
    lp.Q.value = 1.4;

    // Subtle highpass to keep the buzz from muddying the bottom end
    // (the road-noise voice already owns 80–400 Hz).
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;

    const g = ctx.createGain();
    g.gain.value = 0;

    osc.connect(lp);
    oscSub.connect(subMix).connect(lp);
    lp.connect(hp).connect(g).connect(masterGain);
    osc.start();
    oscSub.start();

    engineBuzz = { osc, oscSub, lp, hp, gain: g };
  }

  // ── Bundled-clip engine voice ──────────────────────────────────
  // After several iterations of procedural engine synthesis (single-
  // cylinder oscillator stack, then a V8 dual-exhaust model with
  // burble LFO) the user asked us to go back to the imported audio
  // files for a satisfying drive feel. The K_Std bank ships purpose-
  // recorded loops:
  //
  //   • idle  → idle_NoiseReduction.b.32.ogg   — engine at rest
  //   • run   → AccelNormal.ry.32.ogg          — under-throttle loop
  //   • dash  → DashEngine.ry.32.ogg           — boost layer
  //
  // We keep it simple: idle and run both loop continuously, their
  // gains crossfade based on RPM, and both pickup a small playback-
  // rate bump with RPM so the pitch tracks effort. dash is silent
  // until a boost activates, then ducks in over the run loop.
  function ensureLoopsStarted() {
    if (started) return;
    startLoop('idle');
    startLoop('run');
    startLoop('dash');
    if (!road) buildRoadVoice();
    if (!squeal) buildSquealVoice();
    if (!engineBuzz) buildEngineBuzzVoice();
    started = true;
  }

  // Per-frame state. `speed` is in m/s, `throttle` 0..1.
  function update(state = {}) {
    if (!ready) return;
    ensureLoopsStarted();

    const speed         = Math.max(0, +state.speed         || 0);
    const throttle      = clamp01(+state.throttle          || 0);
    const lateralSpeed  = Math.max(0, +state.lateralSpeed  || 0);
    const drifting      = !!state.drifting;
    const charging      = !!state.charging;
    const boosting      = !!state.boosting;
    const exploded      = !!state.exploded;
    const braking       = !!state.braking;
    const grounded      = state.grounded === undefined ? true : !!state.grounded;

    // Drift-lock: while the kart is in a sustained drift/charge the
    // audio mix is hard-pinned to a small set of stable layers (see
    // the engine + road blocks below). This flag also tells
    // playOneShot to drop the per-tier miniTurbo blips and the
    // dashStop chirp — those edge-triggered one-shots stack on top
    // of the already-running squeal/engine bed and are heard as
    // the "random fade in/out" tones the player reported.
    const driftLock = drifting || charging;
    playOneShot._driftSuppress = driftLock;

    // ── Engine RPM model ────────────────────────────────────────
    // Continuous, no discrete gear shifts. Earlier versions modelled a
    // 4-speed transmission where RPM dropped 0.5 at each gear boundary
    // — that produced audible "the engine just looped" artifacts as
    // the loop gain + playbackRate snapped at every shift. A smooth
    // curve sounds more like a continuously-variable kart engine
    // (which is also what go-kart engines actually are).
    //
    // Mapping
    //   • Idle floor          : 0.18 (engine never goes silent)
    //   • Speed contribution  : 0..0.55 across 0..35 m/s (gentle curve
    //                            via x^0.7 so the rumble lifts quickly
    //                            from a standstill, then plateaus)
    //   • Throttle "load"     : adds up to +0.35 ON TOP of the speed
    //                            curve when pedal is mashed
    //   • Engine-brake floor  : when throttle is released at speed,
    //                            RPM falls only to (speed term × 0.85)
    //                            so a coasting kart still hums and
    //                            spools down audibly
    const speedN = Math.min(1, speed / 35);
    const speedTerm = Math.pow(speedN, 0.7) * 0.55;       // 0..0.55
    const loadedTarget = Math.min(0.95, 0.18 + speedTerm + throttle * 0.35);
    // Coasting target — when the throttle is fully released the
    // engine note should collapse essentially to idle (the throttle
    // plate is shut), regardless of how fast the kart is still
    // rolling. We bias coastTarget heavily toward the idle floor and
    // let only a small residue of speedTerm bleed in so a coasting
    // kart still has a faint "engine spinning over" character.
    const coastTarget  = Math.max(0.18, speedTerm * 0.15 + 0.18);
    let rpm = coastTarget + (loadedTarget - coastTarget) * throttle;

    // Special states.
    if (exploded) rpm = 0;                                    // engine off
    if (boosting) rpm = Math.max(rpm, 0.92);                  // boost pegs near redline
    if (charging) rpm = Math.max(rpm, 0.85);                  // burnout = high revs at zero speed

    // Stomp-the-gas flare. When throttle jumps hard from a low value
    // and current RPM is still low, force a brief over-rev so the
    // listener hears the engine catch. Uses absolute performance.now()
    // timestamps so the flare can't be retriggered until it's expired.
    if (typeof update._lastThrottle !== 'number') update._lastThrottle = 0;
    const tNow = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const throttleJump = throttle - update._lastThrottle;
    if (throttleJump > 0.40
        && (update._rpm === undefined || update._rpm < 0.55)
        && !exploded
        && (tNow - (update._flareLastAt || 0)) > 700) {
      update._flareUntilTs = tNow + 180;                      // 180 ms flare
      update._flareLastAt = tNow;
    }
    update._lastThrottle = throttle;
    if (update._flareUntilTs && tNow < update._flareUntilTs) {
      // Smooth bell-curve flare so it ramps in/out instead of clipping.
      const remaining = (update._flareUntilTs - tNow) / 180;  // 1 → 0
      const bell = Math.sin(remaining * Math.PI);             // 0 → 1 → 0
      rpm = Math.max(rpm, 0.55 + 0.25 * bell);                // up to 0.80
    } else if (update._flareUntilTs && tNow >= update._flareUntilTs) {
      update._flareUntilTs = 0;
    }

    // Asymmetric smoothing — engines accelerate at a measured rate
    // under throttle, but the moment the driver lifts off the gas
    // the audible RPM should drop almost instantly (the throttle
    // plate snaps shut and the engine note collapses long before
    // road speed scrubs off). Both rates still avoid a hard step
    // that would click.
    if (typeof update._rpm !== 'number') update._rpm = 0.18;
    const isRevUp = rpm > update._rpm;
    let k;
    if (isRevUp) {
      k = throttle > 0.5 ? 0.18 : 0.10;                       // hard accel vs cruise
    } else if (throttle < 0.05) {
      k = 0.55;                                                // gas released → snap down
    } else {
      k = 0.18;                                                // partial-throttle coast
    }
    update._rpm += (rpm - update._rpm) * k;
    rpm = update._rpm;

    // (speedN is already declared above in the engine RPM block and
    // reused below by the squeal + road-noise voices.)

    // ── Engine voices ──────────────────────────────────────
    // The engine sound is now layered:
    //   1. IDLE sample loop — sole sample-based voice, pitched across
    //      the FULL powerband (rate 0.65 → 2.40) so it serves as a
    //      single continuous engine recording from idle to redline.
    //      Earlier the run loop crossfaded in over idle around mid-RPM,
    //      which produced an audible handoff (two recordings beating
    //      against each other) and made the engine sound out of sync
    //      with the actual powerband.
    //   2. SYNTH BUZZ — sawtooth oscillator stack whose fundamental
    //      tracks RPM and whose lowpass cutoff opens with throttle.
    //      Gain ramps with throttle so it kicks in immediately when
    //      the player gets on the gas, which is what gives the engine
    //      its responsive feel — something pitched samples alone can't
    //      provide because they're stretched, not retriggered.
    //   3. RUN sample loop — demoted to a subtle high-RPM harmonic
    //      layer (only audible above rpm ≈ 0.75) for a touch of
    //      recorded grit at the top end.
    //   4. DASH sample loop — unchanged, fades in only during boost.
    const engineMaster = exploded ? 0 : 1;
    // ENGINE_TRIM scales every engine-related voice (idle, run, dash,
    // synth buzz). Was 0.75 — reduced by another 25% per user request
    // (0.75 × 0.75 = 0.5625) so the engine sits further behind the
    // squeal / road / item sounds in the overall mix.
    const ENGINE_TRIM = 0.5625;

    // Idle sample now spans the entire RPM range as the sole sample
    // engine voice. The pitch sweep + gain ramp are profile-driven so
    // V8 banks (lo-SR PCM that aliases past ~2.2×) get a narrower
    // sweep than the K_Std studio recording.
    // sampleEngineMuted (V8 kits): zero out idle/run/dash sample gains
    // so any vocal/radio artifacts in the source recordings are
    // completely silent. The synth-buzz voice carries the engine
    // alone in that mode.
    const sampleMute = profile.sampleEngineMuted ? 0 : 1;
    const idleRate = profile.idleRateBase + rpm * profile.idleRateRpm;
    const idleVol  = (0.30 + rpm * 0.40) * engineMaster * ENGINE_TRIM * sampleMute;

    // Top-end factor — ramps from 0 → 1 across the profile's top-end
    // band. Used below to push the synth buzz brighter & louder and
    // to bring the run-loop harmonic forward.
    const topEnd = smooth01(rpm, profile.topEndStart, profile.topEndEnd);

    // Run loop crossfade — V8 profile brings this in much earlier so
    // the recording has a real "stepping through the powerband" feel
    // instead of being an idle-sample-stretched-up.
    const runMix   = smooth01(rpm, profile.runEnterStart, profile.runEnterEnd);
    const runVol   = (0.14 + topEnd * 0.12) * runMix * engineMaster * ENGINE_TRIM * profile.runGainMultiplier * sampleMute;
    const runRate  = profile.runRateBase + rpm * profile.runRateRpm;

    if (driftLock) {
      // Drift-lock: pin a single fixed point on the powerband for the
      // entire drift. Idle voice is held at one rate/gain, run is muted,
      // synth buzz is held at one cutoff so the texture doesn't churn.
      // Slow ramps in/out so engaging the lock doesn't snap the engine.
      setLoopGain('idle', 0.65 * engineMaster * ENGINE_TRIM * sampleMute, 0.30);
      setLoopRate('idle', 1.85,                              0.30);
      setLoopGain('run',  0,                                  0.30);
      if (engineBuzz) {
        engineBuzz.osc.frequency.setTargetAtTime(220, ctx.currentTime, 0.30);
        engineBuzz.oscSub.frequency.setTargetAtTime(110, ctx.currentTime, 0.30);
        engineBuzz.lp.frequency.setTargetAtTime(1700, ctx.currentTime, 0.30);
        engineBuzz.gain.gain.setTargetAtTime(0.075 * engineMaster * ENGINE_TRIM * profile.buzzMultiplier, ctx.currentTime, 0.30);
      }
    } else {
      const xfadeTau = boosting ? 0.22 : 0.10;
      setLoopGain('idle', idleVol, xfadeTau);
      setLoopRate('idle', idleRate, 0.10);
      setLoopGain('run',  runVol,  xfadeTau);
      setLoopRate('run',  runRate, 0.10);

      // Synth buzz — the part that actually responds to player input
      // in real time. Fundamental sweeps a wide range so the listener
      // hears continuous pitch movement as RPM changes; lowpass cutoff
      // and gain are throttle-driven so getting on the gas instantly
      // "opens up" the engine without waiting for RPM to climb.
      if (engineBuzz) {
        // Fundamental: 55 Hz at full idle → 320 Hz at redline, with an
        // additional +120 Hz "top-end stretch" once rpm crosses 0.78
        // (was +200 Hz — reduced so the peak pitch is less piercing
        // while still climbing through the powerband).
        const fundamental = 55 + rpm * 265 + topEnd * 120;
        engineBuzz.osc.frequency.setTargetAtTime(fundamental, ctx.currentTime, 0.06);
        engineBuzz.oscSub.frequency.setTargetAtTime(fundamental * 0.5, ctx.currentTime, 0.06);
        // Throttle-driven cutoff with a moderated top-end push. The
        // rpm-driven and topEnd brightness terms drove the engine's
        // "biting" character at high rpm; trimmed (rpm*600 → rpm*350,
        // topEnd*1800 → topEnd*900) so a flat-out engine is still
        // bright but no longer harsh on the high end.
        const cutoff = (180 + throttle * 1900 + rpm * 350 + topEnd * 900);
        engineBuzz.lp.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.05);
        // Gain. Idle floor of 0.020 keeps the buzz always faintly
        // present; throttle brings it up. The rpm and topEnd
        // contributions are halved (0.02 → 0.012, 0.05 → 0.025) so a
        // pinned-throttle redline still reads as effort but no longer
        // pushes the buzz layer to the front of the mix.
        const buzzGain = (0.020 + throttle * 0.08 + rpm * 0.012 + topEnd * 0.025) * engineMaster * ENGINE_TRIM * profile.buzzMultiplier;
        engineBuzz.gain.gain.setTargetAtTime(buzzGain, ctx.currentTime, 0.04);
      }
    }

    // Boost layer — keep the bundled "dash" clip as a one-shot impact
    // layer that fades in only while boosting. It plays under the
    // synthesized engine rather than replacing it, so the engine is
    // continuous through the boost transition. Slower fade-out (tau
    // 0.18 s) than fade-in (0.08 s) so the dash layer doesn't click
    // off the instant a boost ends, which previously overlapped with
    // the dashStop one-shot in an unpleasant way.
    // Mix coefficient was 0.35 — reduced to 0.26 so the boost layer
    // sits with the new lower top-end exhaust mix instead of
    // suddenly jumping forward when boost engages.
    const boostMix = boosting ? 1 : 0;
    const dashTau = boostMix > 0 ? 0.08 : 0.18;
    setLoopGain('dash', 0.26 * boostMix * (exploded ? 0.30 : 1.0) * ENGINE_TRIM * sampleMute, dashTau);
    setLoopRate('dash', profile.dashRateBase + rpm * profile.dashRateRpm, 0.20);

    // Skid / wheelspin squeal. Multiple sources can produce tire scrub:
    //   • drift slide (handbrake + steering)            → strong squeal
    //   • burnout charge (stationary wheelspin)         → high-pitch squeal
    //   • hard braking at speed                         → mid squeal
    //   • lateral side-slip (wheels off heading)        → light scrub
    // We pick the strongest source per frame and ramp the synthesized
    // squeal voice toward it so the sound swells in/out smoothly
    // instead of clicking on/off.
    const slipFromLat   = grounded ? clamp01(lateralSpeed / 8) : 0;     // 0..1 across 0..8 m/s side-slip
    const slipFromBrake = (grounded && braking && speed > 4) ? 0.55 : 0;
    const slipFromDrift = (grounded && drifting && speed > 2) ? 0.75 : 0;
    const slipFromBurn  = charging ? 0.85 : 0;
    // Smooth the raw slip target so the squeal voice doesn't pulse on/off
    // when the drift / brake / charging flags toggle (e.g. mid-drift edge
    // transitions that snap slipFromDrift binary 0 ↔ 0.75). Asymmetric
    // smoothing — slip in faster than it drops out, so squeals respond
    // immediately to a new slide but don't click off the moment a drift
    // breaks (lets the residual slip from lateral velocity carry it down).
    const slipRaw = Math.max(slipFromLat, slipFromBrake, slipFromDrift, slipFromBurn);
    if (typeof update._slipSm !== 'number') update._slipSm = 0;
    const slipK = slipRaw > update._slipSm ? 0.35 : 0.12;
    update._slipSm += (slipRaw - update._slipSm) * slipK;
    const slip = update._slipSm;
    if (squeal) {
      // Skid voice sits forward in the mix — drift / burnout / brake
      // squeals are major feedback cues so the listener should feel
      // them clearly. 0.672 base (was 0.56, +20%) lifts them further.
      const squealGain = exploded ? 0 : 0.672 * slip;
      squeal.gain.gain.setTargetAtTime(squealGain, ctx.currentTime, 0.08);
      // Slip intensity drives the bandpass centres up — harder skids
      // sit higher in the spectrum, like real rubber. Burnout pushes
      // the centre even higher (wheels spinning faster than ground).
      const baseShift = slip * 350 + (charging ? 250 : 0);
      squeal.bp1.frequency.setTargetAtTime(1700 + baseShift, ctx.currentTime, 0.10);
      squeal.bp2.frequency.setTargetAtTime(2550 + baseShift * 1.2, ctx.currentTime, 0.10);
    }

    // Brake-onset chirp — short squeal pop on the leading edge of a
    // hard brake at speed. Done with a quick gain envelope on the
    // squeal voice rather than a sample one-shot so the timbre matches.
    // Suppressed while drifting / charging so the chirp doesn't fight
    // the persistent slide squeal that's already running at full gain
    // (the cancelScheduledValues here would clobber the smooth ramp
    // and create an audible pulse).
    if (braking && speed > 6 && grounded && !exploded && !drifting && !charging && squeal) {
      const now = ctx.currentTime;
      if (now - (update._lastBrakeChirpAt || 0) > 0.30 && !update._wasBraking) {
        // Quick attack, short hold, fast release — ~180 ms total.
        const g = squeal.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(1.02, now + 0.020);
        g.linearRampToValueAtTime(0.672 * slip, now + 0.180);
        update._lastBrakeChirpAt = now;
      }
    }
    update._wasBraking = braking && grounded;

    // ── Road / rolling-noise rumble ────────────────────────────────
    // Synthesized bandpassed pink noise; gain rises with speed and
    // mutes when the kart is airborne or essentially stopped. The
    // bandpass centre also opens up a touch with speed so the
    // surface gets "brighter" the faster you go.
    if (road) {
      if (driftLock) {
        // Drift-lock road noise — freeze the bandpass + rate at one
        // setting and hold a quiet steady gain. Modulating the road
        // bandpass against the speed jitter inside a drift contributes
        // its own slow swoosh that compounds with the squeal; pinning
        // it lets the squeal carry the entire drift texture.
        const roadTarget = grounded ? 0.10 : 0;
        road.gain.gain.setTargetAtTime(roadTarget, ctx.currentTime, 0.25);
        road.bp.frequency.setTargetAtTime(280, ctx.currentTime, 0.30);
        road.src.playbackRate.setTargetAtTime(1.05, ctx.currentTime, 0.30);
      } else {
        const roadSpeedN = clamp01((speed - 1.5) / 30);  // dead-band below ~1.5 m/s
        const roadTarget = grounded ? (0.18 * roadSpeedN) : 0;
        road.gain.gain.setTargetAtTime(roadTarget, ctx.currentTime, 0.10);
        road.bp.frequency.setTargetAtTime(150 + roadSpeedN * 220, ctx.currentTime, 0.15);
        // Subtle pitch slide via playbackRate keeps the noise grain
        // tied to perceived speed without changing the bandpass shape.
        road.src.playbackRate.setTargetAtTime(0.85 + roadSpeedN * 0.40, ctx.currentTime, 0.20);
      }
    }
  }

  function setMasterVolume(v) {
    masterGain.gain.setTargetAtTime(clamp01(v), ctx.currentTime, 0.05);
  }

  return {
    update, playOneShot, setMasterVolume, ctx,
    get ready() { return ready; },
  };
}
