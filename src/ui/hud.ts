import type { Sim } from "../sim/sim";
import { KIND_ENEMY, KIND_GEM } from "../sim/world";
import { PLAYER_MAX_HP } from "../config/balance";

// Minimal DOM HUD: survival timer, level/XP, HP, and live entity counts. Reads
// straight from the Sim each frame (cheap; the strings are tiny).

function mmss(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export class Hud {
  constructor(private readonly el: HTMLElement) {}

  update(sim: Sim): void {
    const enemies = sim.world.countOf(KIND_ENEMY);
    const gems = sim.world.countOf(KIND_GEM);
    const hp = Math.ceil(sim.playerHp);
    this.el.innerHTML = [
      `VANTAGE`,
      `time ${mmss(sim.time)}`,
      `lvl ${sim.playerLevel}  xp ${sim.xp}/${sim.xpForNextLevel()}`,
      `hp ${hp}/${PLAYER_MAX_HP}`,
      `kills ${sim.kills}`,
      `enemies ${enemies}  gems ${gems}`,
    ].join("&nbsp;&nbsp;·&nbsp;&nbsp;");
  }
}
