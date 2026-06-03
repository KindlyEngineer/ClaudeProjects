import { normalize2 } from "../core/math";

// Keyboard input → a normalized movement intent on the XZ plane.
// Screen-up (W / ArrowUp) maps to -Z, which moves "into" the tilted view.

export class Input {
  private keys = new Set<string>();

  constructor(target: Window | HTMLElement = window) {
    target.addEventListener("keydown", (e) => this.keys.add((e as KeyboardEvent).code));
    target.addEventListener("keyup", (e) => this.keys.delete((e as KeyboardEvent).code));
  }

  /** Returns a unit-length (or zero) move vector { x, z }. */
  moveVector(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    const [nx, nz] = normalize2(x, z);
    return { x: nx, z: nz };
  }
}
