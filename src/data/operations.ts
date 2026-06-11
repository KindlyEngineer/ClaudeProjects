import type { MapDef, OperationDef } from "./types";
import { MAP01 } from "./maps/map01";
import { MAP02 } from "./maps/map02";
import { MAP03 } from "./maps/map03";
import { randomSkirmishMap, type ForcePreset } from "./maps/gen";

// Operations are data: an ordered battle list + stockpile economics. The map
// registry resolves battle mapIds so operation defs stay serializable —
// including GENERATED ones (H2): a generated map's id encodes the seed and
// battle index, so a checkpoint save regenerates the identical campaign.

export const MAPS: Record<string, MapDef> = {
  map01: MAP01,
  map02: MAP02,
  map03: MAP03,
};

// Generated battle maps: "genmap-<opSeed>-<battleIndex>" → deterministic
// regeneration (memoized — cells arrays are big and mapById is called often).
const PRESETS: readonly ForcePreset[] = ["standard", "standard", "heavy"]; // escalation; battle 0 fixes the mech roster
const genMapCache = new Map<string, MapDef>();

export function genMapId(opSeed: number, battleIndex: number): string {
  return `genmap-${opSeed}-${battleIndex}`;
}

export function mapById(id: string): MapDef {
  const m = MAPS[id];
  if (m) return m;
  const g = /^genmap-(\d+)-([0-2])$/.exec(id);
  if (g) {
    let cached = genMapCache.get(id);
    if (!cached) {
      const seed = Number(g[1]);
      const i = Number(g[2]);
      cached = randomSkirmishMap(seed * 13 + i * 101 + 7, PRESETS[i]);
      genMapCache.set(id, cached);
    }
    return cached;
  }
  throw new Error(`unknown map '${id}'`);
}

/** The first operation: three linked battles following one task force east.
 *  Full carry-over (owner ruling D1): the state you end a battle with is the
 *  state you start the next with — minus whatever the Interlude can put back. */
export const OPERATION_01: OperationDef = {
  id: "op01",
  name: "Operation Eastern Gate",
  blurb:
    "Three battles east along one axis: take the ridge, cross the steppe, force the gap. " +
    "Whatever survives a battle fights the next one. You run the depot; the commander runs the fight.",
  battles: [
    {
      mapId: "map01",
      title: "Battle I — Ridge Approach",
      briefing:
        "Seize the urban zone across the ridge line. The defence is dug in around the objective; " +
        "its approaches are unscouted. The clock is short.",
      award: {
        win: { credits: 70, ammo: 30, fuel: 60, repair: 35, strikes: 1, recon: 1 },
        loss: { credits: 25, ammo: 15, fuel: 30, repair: 25, recon: 1 },
      },
    },
    {
      mapId: "map02",
      title: "Battle II — Open Steppe",
      briefing:
        "Exploit east across open ground. Little cover, long sightlines — high ground and smoke decide " +
        "who shoots first. Expect a thinner but mobile defence.",
      award: {
        win: { credits: 80, ammo: 35, fuel: 70, repair: 40, strikes: 1, recon: 1 },
        loss: { credits: 30, ammo: 20, fuel: 35, repair: 25, recon: 1 },
      },
    },
    {
      mapId: "map03",
      title: "Battle III — The Gap",
      briefing:
        "The finale: force the defile between the ridgelines and break out over the eastern edge. " +
        "The defence is deep and layered, with its own air. Losing here loses the operation.",
      award: { win: { credits: 100 }, loss: {} },
    },
  ],
  // Generous starting credits: the player COMPOSES their support echelon from
  // scratch (M2.6). Leftover rolls into the operation for reinforcement; awards
  // top it up. The old default echelon cost ~250 — this affords that plus choice.
  initialStockpile: { ammo: 40, fuel: 80, repair: 40, strikes: 1, recon: 2, credits: 340 },
  mechPrice: 150,
  supportCap: 8,
  supportCatalog: [
    { type: "recon", price: 30 },
    { type: "infantry", price: 25 },
    { type: "atgm_team", price: 45 },
    { type: "engineer", price: 30 },
    { type: "armor", price: 60 },
    { type: "heavy_tank", price: 95 },
    { type: "aa_vehicle", price: 55 },
    { type: "ew_vehicle", price: 65 },
    { type: "artillery", price: 70 },
    { type: "mortar_team", price: 40 },
    { type: "supply", price: 35 },
    { type: "heavy_supply", price: 60 },
  ],
};

export const OPERATIONS: Record<string, OperationDef> = { op01: OPERATION_01 };

// ── Generated operations (H2): a seeded campaign on the map generator ─────────

const genOpCache = new Map<number, OperationDef>();

/** A GENERATED three-battle operation, deterministic per seed: seeded maps
 *  (standard → standard → heavy escalation), the same economy as the
 *  handcrafted campaign, full persistent-enemy/trust/records machinery for
 *  free (they all hang off OperationState, not the def). */
export function generatedOperation(seed: number): OperationDef {
  let def = genOpCache.get(seed);
  if (def) return def;
  const titles = ["Battle I — First Contact", "Battle II — The Push", "Battle III — The Breaking Point"];
  const briefings = [
    "A generated front. Seize the urban zone east of the line of departure; the approaches are unscouted and the defence is real.",
    "Exploit while they're off balance. The formation you meet is whatever survived Battle I — your attrition is your advantage.",
    "The finale on the hardest ground the front has. Heavy armour, air defence and mortars. Losing here loses the operation.",
  ];
  def = {
    id: "genop",
    name: `Operation Cold Forge ${seed}`,
    blurb:
      `A generated campaign (seed ${seed}): three seeded battles along one axis, full carry-over, ` +
      "a persistent enemy. You run the depot; the commander runs the fight.",
    battles: [0, 1, 2].map((i) => ({
      mapId: genMapId(seed, i),
      title: titles[i],
      briefing: briefings[i],
      award:
        i === 2
          ? { win: { credits: 100 }, loss: {} }
          : {
              win: { credits: 75 + i * 10, ammo: 30, fuel: 60, repair: 35, strikes: 1, recon: 1 },
              loss: { credits: 25, ammo: 15, fuel: 30, repair: 20, recon: 1 },
            },
    })),
    initialStockpile: OPERATION_01.initialStockpile,
    mechPrice: OPERATION_01.mechPrice,
    supportCap: OPERATION_01.supportCap,
    supportCatalog: OPERATION_01.supportCatalog,
  };
  genOpCache.set(seed, def);
  return def;
}

/** Resolve an operation def — static registry first, generated by seed after.
 *  The (defId, seed) pair is all a checkpoint save stores. */
export function resolveOperationDef(defId: string, seed: number): OperationDef {
  if (OPERATIONS[defId]) return OPERATIONS[defId];
  if (defId === "genop") return generatedOperation(seed);
  throw new Error(`unknown operation '${defId}'`);
}
