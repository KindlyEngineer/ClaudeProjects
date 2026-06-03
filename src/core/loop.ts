// Fixed-timestep game loop with render interpolation.
//
// The sim advances in fixed steps (deterministic, stable physics); rendering
// happens every animation frame and interpolates between the previous and
// current sim state via `alpha` for smooth motion regardless of frame rate.

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. Called 0..N times/frame. */
  update: (dt: number) => void;
  /** Draw, interpolating between sim states. `alpha` in [0,1). */
  render: (alpha: number) => void;
}

/** Starts the loop and returns a stop() function. */
export function startLoop(cb: LoopCallbacks, fixedDt: number): () => void {
  let last = performance.now() / 1000;
  let accumulator = 0;
  let raf = 0;

  const frame = () => {
    const now = performance.now() / 1000;
    let frameTime = now - last;
    last = now;
    // Clamp to avoid a "spiral of death" after a long stall (e.g. tab backgrounded).
    if (frameTime > 0.25) frameTime = 0.25;

    accumulator += frameTime;
    while (accumulator >= fixedDt) {
      cb.update(fixedDt);
      accumulator -= fixedDt;
    }
    cb.render(accumulator / fixedDt);
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
