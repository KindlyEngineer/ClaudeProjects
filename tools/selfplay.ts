// Bulk AI-vs-AI self-play across a SET of scenarios — the brief's primary
// balance / termination / crash / invariant harness. Both sides fully AI;
// reports per-scenario and aggregate attacker/defender win split, match length,
// and any invariant violations.
//
// Usage: npx tsx tools/selfplay.ts [N]   (default 100 seeds per scenario)

import { createGame, livingUnits } from "../src/sim/state";
import { noSupport, runMatch } from "../src/sim/match";
import type { MapDef } from "../src/data/types";
import { MAP01, MAP01_BREAKTHROUGH } from "../src/data/maps/map01";
import { MAP02 } from "../src/data/maps/map02";
import { MAP03 } from "../src/data/maps/map03";
import { MAP04 } from "../src/data/maps/map04";
import { MAP05 } from "../src/data/maps/map05";
import { randomSkirmishMap } from "../src/data/maps/gen";

const N = Number(process.argv[2] ?? 100);

const scenarios: Array<{ name: string; map: MapDef }> = [
  { name: "Ridge — Seize", map: MAP01 },
  { name: "Ridge — Breakthrough", map: MAP01_BREAKTHROUGH },
  { name: "Steppe — Seize", map: MAP02 },
  { name: "The Gap — Breakthrough", map: MAP03 }, // both sides holding air
  { name: "Watchline — Defense", map: MAP04 }, // RED attacks; blue holds
  { name: "Causeway — Crossing", map: MAP05 }, // the smoke lesson
  { name: "Random — seed-of-seeds", map: randomSkirmishMap(42) }, // generator soundness
];

const allAi = (map: MapDef): MapDef => ({ ...map, units: map.units.map((u) => ({ ...u, controller: "ai" as const })) });
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;

let aggAtt = 0;
let aggTotal = 0;
let violations = 0;
let turnSum = 0;

console.log(`self-play: ${N} seeds × ${scenarios.length} scenarios (both sides AI)`);
for (const sc of scenarios) {
  const map = allAi(sc.map);
  let att = 0;
  let def = 0;
  for (let seed = 1; seed <= N; seed++) {
    const s = createGame(map, seed);
    const r = runMatch(s, noSupport);
    const attackerWon = r.outcome === sc.map.objective.attacker;
    if (r.outcome === "blue" || r.outcome === "red") attackerWon ? att++ : def++;
    else violations++;
    if (r.turns > s.objective.turnLimit + 1) violations++;
    turnSum += r.turns;
    for (const u of livingUnits(s)) {
      if (u.supply < 0 || u.fuel < 0 || Math.min(0, ...u.ammo) < 0) {
        violations++;
        break;
      }
    }
  }
  aggAtt += att;
  aggTotal += att + def;
  console.log(`  ${sc.name.padEnd(22)} attacker ${pct(att, N)}  ·  defender ${pct(def, N)}`);
}

console.log(`  ${"AGGREGATE".padEnd(22)} attacker ${pct(aggAtt, aggTotal)}  ·  defender ${pct(aggTotal - aggAtt, aggTotal)}`);
console.log(`  avg turns ${(turnSum / Math.max(1, aggTotal)).toFixed(1)}  ·  invariant violations: ${violations}`);
process.exit(violations > 0 ? 1 : 0);
