import type { Weather } from "../data/types";
import type { GameEvent } from "../sim/events";
import { getSettings } from "./settings";

// Procedural audio (Horizon 2, ruling D14 — brief amended): every sound is
// SYNTHESIZED in Web Audio at call time — oscillators, filtered noise and gain
// envelopes. No assets, no files, no pipeline. Strictly render-side: the sim
// never knows sound exists, and the event→sound mapping (`soundIdFor`) is a
// pure function so the vocabulary is unit-testable headlessly. Playback rides
// the SAME fog-gated event stream as the animation and the combat log — you
// hear exactly what you're allowed to see (plus the always-loud: artillery,
// air, the turn radio).

export type SoundId =
  | "blip" // the radio — a new turn crackles in
  | "crack" // a shot that misses or deflects: the report, nothing behind it
  | "thump" // a penetrating hit landing
  | "boom" // a kill, or a mine
  | "bigboom" // an air strike arriving
  | "barrage" // an area suppression mission walking in
  | "hiss" // smoke pouring out
  | "whoosh" // jets overhead (recon pass, or a strike driven off)
  | "tick" // engineers at work
  | "clink"; // a resupply handed over

/** The event→sound vocabulary (pure — tested without an AudioContext). */
export function soundIdFor(ev: GameEvent): SoundId | null {
  switch (ev.kind) {
    case "turn":
      return "blip";
    case "fire":
      if (!ev.hit || !ev.penetrated) return "crack";
      return ev.destroyed ? "boom" : "thump";
    case "mission":
      return ev.mission === "suppress" ? "barrage" : "hiss";
    case "offmap":
      if (ev.asset === "recon" || ev.intercepted) return "whoosh";
      return "bigboom";
    case "mine":
      return "boom";
    case "build":
      return "tick";
    case "resupply":
      return "clink";
    default:
      return null; // moves, facings and phase ticks pass in silence
  }
}

// ── The synthesizer ───────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!getSettings().audio) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
    } catch {
      return null; // no Web Audio here (old browser, headless oddity) — silence
    }
  }
  if (ctx.state === "suspended") void ctx.resume(); // autoplay policy: wakes on a gesture
  return ctx;
}

/** Call on the first user gesture — browsers keep audio suspended until one. */
export function unlockAudio(): void {
  ac();
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function env(c: AudioContext, t0: number, peak: number, dur: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(master!);
  return g;
}

/** A filtered noise burst (cracks, booms, hisses — most of war is noise). */
function hit(c: AudioContext, at: number, o: { dur: number; gain: number; type: BiquadFilterType; freq: number; sweepTo?: number; q?: number }): void {
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t0);
  if (o.sweepTo) f.frequency.linearRampToValueAtTime(o.sweepTo, t0 + o.dur);
  f.Q.value = o.q ?? 1;
  src.connect(f);
  f.connect(env(c, t0, o.gain, o.dur));
  src.start(t0);
  src.stop(t0 + o.dur);
}

/** A pitched tone with a frequency drop (thumps, reports, radio beeps). */
function tone(c: AudioContext, at: number, o: { dur: number; gain: number; from: number; to?: number; shape?: OscillatorType }): void {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = o.shape ?? "sine";
  osc.frequency.setValueAtTime(o.from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to ?? o.from), t0 + o.dur);
  osc.connect(env(c, t0, o.gain, o.dur));
  osc.start(t0);
  osc.stop(t0 + o.dur);
}

const RECIPES: Record<SoundId, (c: AudioContext) => void> = {
  blip: (c) => {
    tone(c, 0, { dur: 0.05, gain: 0.07, from: 1150, shape: "square" });
    tone(c, 0.07, { dur: 0.05, gain: 0.05, from: 920, shape: "square" });
    hit(c, 0, { dur: 0.16, gain: 0.025, type: "bandpass", freq: 1800, q: 0.6 }); // the crackle under it
  },
  crack: (c) => {
    hit(c, 0, { dur: 0.07, gain: 0.22, type: "highpass", freq: 2200 });
    tone(c, 0, { dur: 0.09, gain: 0.16, from: 240, to: 70 });
  },
  thump: (c) => {
    hit(c, 0, { dur: 0.06, gain: 0.18, type: "highpass", freq: 2000 });
    tone(c, 0.02, { dur: 0.22, gain: 0.3, from: 130, to: 40 });
  },
  boom: (c) => {
    hit(c, 0, { dur: 0.5, gain: 0.38, type: "lowpass", freq: 520 });
    tone(c, 0, { dur: 0.5, gain: 0.34, from: 95, to: 28 });
  },
  bigboom: (c) => {
    hit(c, 0, { dur: 0.25, gain: 0.2, type: "bandpass", freq: 700, sweepTo: 2200, q: 0.7 }); // it comes in first
    hit(c, 0.2, { dur: 0.8, gain: 0.45, type: "lowpass", freq: 420 });
    tone(c, 0.2, { dur: 0.8, gain: 0.4, from: 80, to: 24 });
    hit(c, 0.45, { dur: 0.5, gain: 0.22, type: "lowpass", freq: 350 });
  },
  barrage: (c) => {
    for (let i = 0; i < 3; i++) {
      hit(c, i * 0.16, { dur: 0.35, gain: 0.22, type: "lowpass", freq: 480 });
      tone(c, i * 0.16, { dur: 0.35, gain: 0.18, from: 85, to: 30 });
    }
  },
  hiss: (c) => hit(c, 0, { dur: 0.7, gain: 0.1, type: "bandpass", freq: 1300, q: 0.5 }),
  whoosh: (c) => hit(c, 0, { dur: 0.8, gain: 0.16, type: "bandpass", freq: 350, sweepTo: 2600, q: 0.8 }),
  tick: (c) => {
    hit(c, 0, { dur: 0.03, gain: 0.14, type: "highpass", freq: 3200 });
    hit(c, 0.12, { dur: 0.03, gain: 0.12, type: "highpass", freq: 3200 });
  },
  clink: (c) => {
    tone(c, 0, { dur: 0.05, gain: 0.07, from: 880, shape: "triangle" });
    tone(c, 0.07, { dur: 0.06, gain: 0.06, from: 660, shape: "triangle" });
  },
};

export function playSound(id: SoundId): void {
  const c = ac();
  if (!c) return;
  try {
    RECIPES[id](c);
  } catch {
    // a synth hiccup never takes the game down
  }
}

/** The one-line hook the playback loop calls per (fog-visible) event. */
export function playEventSound(ev: GameEvent): void {
  const id = soundIdFor(ev);
  if (id) playSound(id);
}

// ── Ambient weather (M3's sky, audible) ──────────────────────────────────────

let ambient: { stop: () => void } | null = null;

export function setAmbient(weather: Weather): void {
  ambient?.stop();
  ambient = null;
  const c = ac();
  if (!c || !master || weather === "clear") return;
  try {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    if (weather === "rain") {
      f.type = "lowpass";
      f.frequency.value = 1100; // steady rain on a hull
      g.gain.value = 0.045;
    } else {
      f.type = "bandpass"; // night wind, slowly breathing
      f.frequency.value = 320;
      f.Q.value = 0.4;
      g.gain.value = 0.03;
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      lfo.frequency.value = 0.13;
      lfoGain.gain.value = 0.015;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();
    }
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
    ambient = {
      stop: () => {
        try {
          src.stop();
        } catch {
          // already stopped
        }
      },
    };
  } catch {
    // no ambience is a fine ambience
  }
}
