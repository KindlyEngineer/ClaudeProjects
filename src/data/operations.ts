import type { MapDef, OperationDef } from "./types";
import { MAP01 } from "./maps/map01";
import { MAP02 } from "./maps/map02";
import { MAP03 } from "./maps/map03";

// Operations are data: an ordered battle list + stockpile economics. The map
// registry resolves battle mapIds so operation defs stay serializable.

export const MAPS: Record<string, MapDef> = {
  map01: MAP01,
  map02: MAP02,
  map03: MAP03,
};

export function mapById(id: string): MapDef {
  const m = MAPS[id];
  if (!m) throw new Error(`unknown map '${id}'`);
  return m;
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
  initialStockpile: { ammo: 40, fuel: 80, repair: 40, strikes: 1, recon: 2, credits: 80 },
  prices: {
    mech: 150, // a requisition fields a fully NEW named entity — never a resurrection
    support: { recon: 30, armor: 60, aa: 55, infantry: 25, engineer: 30, artillery: 70, supply: 35 },
  },
};

export const OPERATIONS: Record<string, OperationDef> = { op01: OPERATION_01 };
