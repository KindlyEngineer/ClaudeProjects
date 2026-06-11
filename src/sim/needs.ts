import { RULES } from "../data/rules";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { assess, attackerShouldAssault } from "./assess";
import { sustainmentNeed } from "./ai";
import { temperamentOf } from "../data/temperaments";
import { hasCrit, livingUnits, unitLabel, type GameState } from "./state";

// The commander's REQUESTS — the legibility surface the whole design rests on.
// The player can't task the mechs (brief: load-bearing), but they must be able
// to read what the autonomous main effort NEEDS from them: ammunition, eyes,
// suppression, an open supply line. Derived purely from the same signals the
// commander AI itself acts on (sustainment, assessment, posture), so the panel
// never lies about what the AI will do. Read-only; deterministic; testable.

export interface CommanderNeed {
  urgency: "warn" | "info";
  text: string;
}

export function commanderNeeds(state: GameState, side: Side): CommanderNeed[] {
  const out: CommanderNeed[] = [];
  const mechs = livingUnits(state, side).filter((u) => u.controller === "ai" && unitType(u.typeId).cls === "mech");

  // While the player DEPLOYS, the commanders comment on the staging — each in
  // its own voice (M3 temperaments). The radio works both ways.
  if (state.deployPending) {
    for (const m of mechs) {
      const t = temperamentOf(m.callSign);
      if (t) out.push({ urgency: "info", text: `${unitLabel(m)} (${t.name}): "${t.voice.deploy}"` });
    }
    return out;
  }

  // Per-mech sustainment — the resupply loop the player owns.
  for (const m of mechs) {
    const name = unitLabel(m);
    if (!m.inSupply) out.push({ urgency: "warn", text: `${name} is CUT OFF — reopen its supply line` });
    const s = sustainmentNeed(m);
    if (s.need >= RULES.commander.needTrigger) {
      out.push({ urgency: "warn", text: `${name}: ${s.reason} — resupply it or it breaks contact` });
    } else if (s.need >= RULES.commander.needTrigger * 0.55) {
      out.push({ urgency: "info", text: `${name}: ${s.reason} — plan a resupply` });
    }
    if (hasCrit(m, "shaken")) out.push({ urgency: "warn", text: `${name}'s crew is shaken — it can't fight until the pressure lifts` });
    if (hasCrit(m, "mobility")) out.push({ urgency: "warn", text: `${name} is immobilised — it will hold and return fire where it stands` });
  }

  // Force-level: what the commander is waiting on before it commits.
  if (mechs.length > 0) {
    const posture = state.posture[side].kind;
    if (side === state.objective.attacker) {
      const a = assess(state, side);
      if (posture === "assault") {
        out.push({ urgency: "info", text: "Assault committed — keep the spearhead fed and the flanks screened" });
      } else if (a.scouted < RULES.commander.minScoutToCommit) {
        out.push({ urgency: "warn", text: "Approach unscouted — the commander needs recon eyes forward before committing" });
      } else if (a.haveContact && !attackerShouldAssault(state, side)) {
        out.push({ urgency: "info", text: "Developing the attack — suppress the defence to open the assault window" });
      }
    } else {
      if (posture === "probe") out.push({ urgency: "info", text: "Probing for information — the commander wants contact" });
      if (posture === "counter") out.push({ urgency: "info", text: "Counterattack underway — exploit it" });
    }
  }

  return out;
}
