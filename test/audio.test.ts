import { describe, it, expect } from "vitest";
import { soundIdFor } from "../src/ui/audio";
import type { GameEvent } from "../src/sim/events";

// Horizon 2 — procedural audio (ruling D14): the synth itself needs a browser,
// but the event→sound VOCABULARY is a pure function — what war sounds like is
// testable headlessly. (Playback rides the same fog-gated stream as the log,
// so hearing leaks nothing seeing doesn't.)

const ev = (partial: Partial<GameEvent> & { kind: GameEvent["kind"] }): GameEvent =>
  ({ seq: 0, turn: 1, ...partial }) as GameEvent;

describe("the event→sound vocabulary", () => {
  it("fire escalates with its outcome: report, impact, kill", () => {
    expect(soundIdFor(ev({ kind: "fire", hit: false, penetrated: false, destroyed: false }))).toBe("crack");
    expect(soundIdFor(ev({ kind: "fire", hit: true, penetrated: false, destroyed: false }))).toBe("crack"); // deflected
    expect(soundIdFor(ev({ kind: "fire", hit: true, penetrated: true, destroyed: false }))).toBe("thump");
    expect(soundIdFor(ev({ kind: "fire", hit: true, penetrated: true, destroyed: true }))).toBe("boom");
  });

  it("missions, air and mines have their own voices", () => {
    expect(soundIdFor(ev({ kind: "mission", mission: "suppress" }))).toBe("barrage");
    expect(soundIdFor(ev({ kind: "mission", mission: "smoke" }))).toBe("hiss");
    expect(soundIdFor(ev({ kind: "offmap", asset: "strike" }))).toBe("bigboom");
    expect(soundIdFor(ev({ kind: "offmap", asset: "strike", intercepted: true }))).toBe("whoosh"); // driven off — heard, not felt
    expect(soundIdFor(ev({ kind: "offmap", asset: "recon" }))).toBe("whoosh");
    expect(soundIdFor(ev({ kind: "mine" }))).toBe("boom");
  });

  it("the quiet verbs: work, handovers, the radio — and silence for the rest", () => {
    expect(soundIdFor(ev({ kind: "build" }))).toBe("tick");
    expect(soundIdFor(ev({ kind: "resupply" }))).toBe("clink");
    expect(soundIdFor(ev({ kind: "turn" }))).toBe("blip");
    expect(soundIdFor(ev({ kind: "move" }))).toBeNull();
    expect(soundIdFor(ev({ kind: "face" }))).toBeNull();
    expect(soundIdFor(ev({ kind: "phase" }))).toBeNull();
  });
});
