import { createGame, type GameState, type UnitInstance } from "../src/sim/state";
import type { Controller, MapDef, ObjectiveDef, Side, UnitPlacement } from "../src/data/types";
import type { Direction, Hex } from "../src/sim/hex";

// Shared test scaffolding (not a suite itself). Builds a small flat open map so
// tests exercise turns/actions/logistics without depending on the real map.

/** Offset (col,row) → axial, matching the real map's rectangular layout. */
export function axial(col: number, row: number): Hex {
  return { q: col, r: row - Math.floor(col / 2) };
}

export interface OpenGameOpts {
  w?: number;
  h?: number;
  seed?: number;
  units: UnitPlacement[];
  objective?: ObjectiveDef;
  terrain?: Array<{ hex: Hex; terrain: string }>;
}

export function openGame(opts: OpenGameOpts): GameState {
  const w = opts.w ?? 12;
  const h = opts.h ?? 6;
  const overrides = new Map<string, string>();
  for (const o of opts.terrain ?? []) overrides.set(`${o.hex.q},${o.hex.r}`, o.terrain);

  const cells = [];
  for (let col = 0; col < w; col++) {
    for (let row = 0; row < h; row++) {
      const hex = axial(col, row);
      cells.push({ hex, terrain: overrides.get(`${hex.q},${hex.r}`) ?? "open", elevation: 0 });
    }
  }
  const objective: ObjectiveDef = opts.objective ?? { kind: "seize", turnLimit: 10, zone: [], attacker: "blue" };
  const map: MapDef = { name: "test", hexSize: 1, cells, units: opts.units, objective };
  return createGame(map, opts.seed ?? 1);
}

export function place(type: string, side: Side, hex: Hex, facing: Direction = 0, controller?: Controller): UnitPlacement {
  return { type, side, hex, facing, controller };
}

/** First living unit of a type (optionally a side). */
export function find(state: GameState, typeId: string, side?: Side): UnitInstance {
  const u = state.units.find((x) => x.typeId === typeId && (side === undefined || x.side === side));
  if (!u) throw new Error(`no ${typeId} (${side ?? "any"}) in game`);
  return u;
}
