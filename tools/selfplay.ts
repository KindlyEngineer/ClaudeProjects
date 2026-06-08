// Bulk AI-vs-AI self-play — the brief's primary balance / termination / crash /
// invariant harness. Runs N seeded matches with BOTH sides fully AI-commanded
// and reports the outcome split, match length, and any invariant violations.
//
// Usage: npx tsx tools/selfplay.ts [N]   (default 200)

import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import { MAP01 } from "../src/data/maps/map01";

const N = Number(process.argv[2] ?? 200);

function allAiGame(seed: number) {
  const map = { ...MAP01, units: MAP01.units.map((u) => ({ ...u, controller: "ai" as const })) };
  return createGame(map, seed);
}

let blue = 0;
let red = 0;
let turnsSum = 0;
let minTurns = Infinity;
let maxTurns = 0;
let violations = 0;

for (let seed = 1; seed <= N; seed++) {
  const s = allAiGame(seed);
  const r = runMatch(s, noSupport);
  if (r.outcome === "blue") blue++;
  else if (r.outcome === "red") red++;
  else violations++; // non-decisive (should never happen)

  turnsSum += r.turns;
  minTurns = Math.min(minTurns, r.turns);
  maxTurns = Math.max(maxTurns, r.turns);
  if (r.turns > s.objective.turnLimit + 1) violations++; // failed to terminate in time

  for (const u of livingUnits(s)) {
    if (u.supply < 0 || u.fuel < 0 || Math.min(0, ...u.ammo) < 0) {
      violations++;
      break;
    }
  }
}

const pct = (n: number) => `${((100 * n) / N).toFixed(0)}%`;
console.log(`self-play: ${N} AI-vs-AI matches on "${MAP01.name}" (Seize; blue attacks, red defends)`);
console.log(`  outcomes : blue ${blue} (${pct(blue)})  ·  red ${red} (${pct(red)})`);
console.log(`  turns    : avg ${(turnsSum / N).toFixed(1)}  ·  min ${minTurns}  ·  max ${maxTurns}`);
console.log(`  invariant violations: ${violations}`);
process.exit(violations > 0 ? 1 : 0);
