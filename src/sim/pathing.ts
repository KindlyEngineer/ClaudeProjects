import { movePoints } from "./actions";
import { moveCostAt } from "./effects";
import { climbCost } from "./elevation";
import { hexKey, neighbors, type Hex } from "./hex";
import { livingUnits, type GameState, type UnitInstance } from "./state";

// Movement reachability — a Dijkstra over passable, unoccupied hexes within a
// unit's move-point/fuel budget. The commander enumerates these as its candidate
// destinations; pathTo reconstructs the route to drive moveUnit.

export interface ReachNode {
  hex: Hex;
  cost: number;
  prev: string | null; // hexKey of the predecessor, null at the start
}

function occupied(state: GameState, h: Hex, moverId: number): boolean {
  return livingUnits(state).some((u) => u.id !== moverId && u.hex.q === h.q && u.hex.r === h.r);
}

/** All hexes the unit could reach this turn (including its current hex), keyed
 *  by hexKey, with the cheapest cost and predecessor for path reconstruction. */
export function reachable(state: GameState, unit: UnitInstance): Map<string, ReachNode> {
  const budget = Math.min(movePoints(unit), Math.floor(unit.fuel));
  const start = unit.hex;
  const nodes = new Map<string, ReachNode>([[hexKey(start), { hex: start, cost: 0, prev: null }]]);
  const frontier: Array<{ key: string; cost: number }> = [{ key: hexKey(start), cost: 0 }];

  while (frontier.length > 0) {
    let mi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i].cost < frontier[mi].cost) mi = i;
    const cur = frontier.splice(mi, 1)[0];
    const node = nodes.get(cur.key)!;
    if (cur.cost > node.cost) continue;
    for (const n of neighbors(node.hex)) {
      const mc = moveCostAt(state, n) + climbCost(state, node.hex, n); // terrain + effects + the climb
      if (!Number.isFinite(mc)) continue;
      if (occupied(state, n, unit.id)) continue;
      const nc = node.cost + mc;
      if (nc > budget) continue;
      const nk = hexKey(n);
      const existing = nodes.get(nk);
      if (!existing || nc < existing.cost) {
        nodes.set(nk, { hex: n, cost: nc, prev: cur.key });
        frontier.push({ key: nk, cost: nc });
      }
    }
  }
  return nodes;
}

/** Reconstruct the path (excluding the start, ending at `targetKey`) from a
 *  reachable() map; empty if the target is the start or unreachable. */
export function pathTo(reach: Map<string, ReachNode>, targetKey: string): Hex[] {
  const path: Hex[] = [];
  let k: string | null = targetKey;
  while (k) {
    const node = reach.get(k);
    if (!node || node.prev === null) break;
    path.unshift(node.hex);
    k = node.prev;
  }
  return path;
}
