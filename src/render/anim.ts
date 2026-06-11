// A tiny tween scheduler for presentation animation (movement, recoil, floating
// text). Module-level so the boot loop can tick it without plumbing; everything
// here is render-side only — the sim has already resolved before a tween runs.

interface Tween {
  start: number;
  dur: number;
  update: (t: number) => void; // t in [0,1], eased
  ease: (t: number) => number;
  resolve: () => void;
}

const active: Tween[] = [];
let now = 0;

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number): number => 1 - (1 - t) ** 2;
export const linear = (t: number): number => t;

let speedDivisor = 1; // settings-driven (M4): normal / fast / instant-ish

export function setAnimSpeed(divisor: number): void {
  speedDivisor = Math.max(1, divisor);
}

/** Run `update(0..1)` over `dur` ms (scaled by the speed setting); resolves
 *  when finished. */
export function tween(dur: number, update: (t: number) => void, ease: (t: number) => number = easeInOut): Promise<void> {
  return new Promise((resolve) => {
    active.push({ start: now, dur: Math.max(1, dur / speedDivisor), update, ease, resolve });
  });
}

export function delay(ms: number): Promise<void> {
  return tween(ms, () => {}, linear);
}

/** Advance all tweens to wall-clock `t` (ms). Call once per animation frame. */
export function tickAnimations(t: number): void {
  now = t;
  for (let i = active.length - 1; i >= 0; i--) {
    const tw = active[i];
    const p = Math.min(1, (t - tw.start) / tw.dur);
    tw.update(tw.ease(p));
    if (p >= 1) {
      active.splice(i, 1);
      tw.resolve();
    }
  }
}

/** Is anything still animating? (The e2e harness waits on this.) */
export function animating(): boolean {
  return active.length > 0;
}
