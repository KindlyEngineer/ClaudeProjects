import { RULES } from "../data/rules";
import type { Side } from "../data/types";
import { unitType } from "../data/units";
import { assess, attackerShouldAssault } from "./assess";
import { sustainmentNeed } from "./ai";
import { temperamentOf } from "../data/temperaments";
import { trustBand } from "./trust";
import { hasCrit, livingUnits, unitLabel, type GameState } from "./state";

// The commander's REQUESTS — the legibility surface the whole design rests on.
// The player can't task the mechs (brief: load-bearing), but they must be able
// to read what the autonomous main effort NEEDS from them: ammunition, eyes,
// suppression, an open supply line. Derived purely from the same signals the
// commander AI itself acts on (sustainment, assessment, posture), so the panel
// never lies about what the AI will do. Read-only; deterministic; testable.
//
// Each need is structured as SPEAKER + CONTENT (who's on the radio, what they
// said) so the comms transcript can format it; `text` remains the assembled
// one-line form the snapshot panel shows.

export interface CommanderNeed {
  urgency: "warn" | "info";
  text: string;
  speaker: string; // a call sign, or "COMMAND" for force-level traffic
  content: string; // the message without the speaker
}

function need(urgency: "warn" | "info", speaker: string, content: string, text?: string): CommanderNeed {
  return { urgency, speaker, content, text: text ?? `${speaker}: ${content}` };
}

export function commanderNeeds(state: GameState, side: Side): CommanderNeed[] {
  const out: CommanderNeed[] = [];
  const mechs = livingUnits(state, side).filter((u) => u.controller === "ai" && unitType(u.typeId).cls === "mech");

  // While the player DEPLOYS, the commanders comment on the staging — each in
  // its own voice (M3 temperaments). The radio works both ways.
  if (state.deployPending) {
    for (const m of mechs) {
      const t = temperamentOf(m.callSign);
      // In operations the call sign's TRUST rides along (D13) — the band is
      // part of the introduction. Skirmish mechs carry no history (no tag).
      const tag = m.trust === undefined ? t?.name : `${t?.name} · ${trustBand(m.trust)}`;
      if (t) out.push(need("info", `${unitLabel(m)} (${tag})`, `"${t.voice.deploy}"`));
    }
    return out;
  }

  // Per-mech sustainment — the resupply loop the player owns.
  for (const m of mechs) {
    const name = unitLabel(m);
    if (!m.inSupply) out.push(need("warn", name, "CUT OFF — reopen its supply line", `${name} is CUT OFF — reopen its supply line`));
    const s = sustainmentNeed(m);
    if (s.need >= RULES.commander.needTrigger) {
      out.push(need("warn", name, `${s.reason} — resupply it or it breaks contact`));
    } else if (s.need >= RULES.commander.needTrigger * 0.55) {
      out.push(need("info", name, `${s.reason} — plan a resupply`));
    }
    if (hasCrit(m, "shaken")) out.push(need("warn", name, "crew is shaken — it can't fight until the pressure lifts", `${name}'s crew is shaken — it can't fight until the pressure lifts`));
    if (hasCrit(m, "mobility")) out.push(need("warn", name, "immobilised — it will hold and return fire where it stands", `${name} is immobilised — it will hold and return fire where it stands`));
    // Trust speaks at the edges (D13) — and says exactly what it changes.
    if (trustBand(m.trust) === "WARY") out.push(need("warn", name, "doubts the support — it will hedge until your deliveries prove out", `${name} doubts the support — it will hedge until your deliveries prove out`));
    else if (trustBand(m.trust) === "ASSURED") out.push(need("info", name, "trusts the line behind it — it will commit harder", `${name} trusts the line behind it — it will commit harder`));
  }

  // Force-level: what the commander is waiting on before it commits.
  if (mechs.length > 0) {
    const posture = state.posture[side].kind;
    if (side === state.objective.attacker) {
      const a = assess(state, side);
      if (posture === "assault") {
        out.push(need("info", "COMMAND", "Assault committed — keep the spearhead fed and the flanks screened", "Assault committed — keep the spearhead fed and the flanks screened"));
      } else if (a.scouted < RULES.commander.minScoutToCommit) {
        out.push(need("warn", "COMMAND", "Approach unscouted — the commander needs recon eyes forward before committing", "Approach unscouted — the commander needs recon eyes forward before committing"));
      } else if (a.haveContact && !attackerShouldAssault(state, side)) {
        out.push(need("info", "COMMAND", "Developing the attack — suppress the defence to open the assault window", "Developing the attack — suppress the defence to open the assault window"));
      }
    } else {
      if (posture === "probe") out.push(need("info", "COMMAND", "Probing for information — the commander wants contact", "Probing for information — the commander wants contact"));
      if (posture === "counter") out.push(need("info", "COMMAND", "Counterattack underway — exploit it", "Counterattack underway — exploit it"));
    }
  }

  return out;
}
