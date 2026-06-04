import type { Sim } from "../sim/sim";
import { KIND_ENEMY, KIND_GEM } from "../sim/world";

// Minimal DOM HUD: survival timer, level/XP, HP, live counts, the current
// weapon/passive loadout, and a boss health readout when one is on the field.
// Reads straight from the Sim each frame (cheap; the strings are tiny).

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
    const weapons = sim.weaponSummary().map(([a, l]) => `${a}·${l}`).join("  ");
    const passives = sim.passiveSummary().map(([a, l]) => `${a}·${l}`).join("  ");

    const line1 = [
      `VANTAGE`,
      `time ${mmss(sim.time)}`,
      `lvl ${sim.playerLevel}  xp ${sim.xp}/${sim.xpForNextLevel()}`,
      `hp ${hp}/${Math.round(sim.maxHp)}`,
      `kills ${sim.kills}`,
      `enemies ${enemies}  gems ${gems}`,
    ].join("&nbsp;&nbsp;·&nbsp;&nbsp;");

    const line2 = `weapons: ${weapons || "—"}${passives ? `&nbsp;&nbsp;|&nbsp;&nbsp;passives: ${passives}` : ""}`;

    const bossFrac = sim.bossHealthFraction();
    const boss = bossFrac > 0 ? `<br>BOSS ${"█".repeat(Math.ceil(bossFrac * 16)).padEnd(16, "░")}` : "";

    this.el.innerHTML = `${line1}<br>${line2}${boss}`;
  }
}
