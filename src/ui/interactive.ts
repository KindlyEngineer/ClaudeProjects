import * as THREE from "three";
import type { View } from "../render/view";
import { buildBoard } from "../render/board";
import { buildHexOverlay } from "../render/overlay";
import type { Side } from "../data/types";
import { moveUnit, attackUnit, resupplyUnit } from "../sim/actions";
import { commandForce, decideUnit } from "../sim/ai";
import { planForce } from "../sim/plan";
import { hexKey, worldToHex, type Hex } from "../sim/hex";
import { evaluateOutcome } from "../sim/objective";
import { pathTo, reachable, type ReachNode } from "../sim/pathing";
import { livingUnits, unitAt, type GameState, type UnitInstance } from "../sim/state";
import { beginTurn, nextPhase } from "../sim/turn";
import { attackOptions, forceCards, readyToOrder, resupplyOptions, type CardModel } from "./control";

// The interactive controller — the human stand-in for the runMatch "player"
// policy. It drives the sim through ONLY the shared action API and only over the
// player's own units; the mechs and the enemy stay AI (commandForce). Selection
// and command follow a BattleTech-style flow: pick a unit (board marker or card),
// its reachable hexes light up, click one to move, then click an enemy to fire
// (or, for supply, an adjacent friendly to resupply). "End Phase" hands the phase
// to the AI for both sides and advances, mirroring runMatch's per-phase ordering
// (player acts, then commandForce blue/red, then nextPhase).

interface Options {
  reach: Map<string, ReachNode>;
  moveKeys: Set<string>; // reachable destination hexKeys (excludes current)
  attack: Map<number, number>; // enemy id → weapon index
  resupply: Set<number>; // friendly ids resuppliable now
}

const EMPTY_OPTIONS: Options = { reach: new Map(), moveKeys: new Set(), attack: new Map(), resupply: new Set() };

export function startInteractive(view: View, state: GameState, opts: { selectId?: number; playerSide?: Side } = {}): void {
  const playerSide: Side = opts.playerSide ?? "blue";
  let selectedId: number | null = opts.selectId ?? null;
  let framed = false;

  // Opening intents so the mech banners read on turn 1 (decideUnit is pure).
  beginTurn(state);
  previewIntents(state);

  const cardsEl = ensure("cards");
  const barEl = ensure("bar");
  const hudEl = document.getElementById("hud");

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let boardGroup: THREE.Group | null = null;
  let overlayGroup: THREE.Group | null = null;
  let markerGroups: THREE.Object3D[] = [];
  let terrainMesh: THREE.Object3D | null = null;

  const selectedUnit = (): UnitInstance | undefined =>
    selectedId == null ? undefined : livingUnits(state).find((u) => u.id === selectedId);

  /** What the selected unit may do right now (empty unless it's the player's and
   *  ready). Shared by the overlays and the click handler so they never diverge. */
  function currentOptions(): Options {
    const u = selectedUnit();
    if (!u || !readyToOrder(state, u)) return EMPTY_OPTIONS;
    const reach = u.movedThisTurn ? new Map<string, ReachNode>() : reachable(state, u);
    const moveKeys = new Set<string>();
    for (const [k, node] of reach) if (node.prev !== null) moveKeys.add(k);
    return { reach, moveKeys, attack: attackOptions(state, u), resupply: resupplyOptions(state, u) };
  }

  function rebuild(): void {
    if (boardGroup) {
      view.scene.remove(boardGroup);
      disposeGroup(boardGroup);
    }
    if (overlayGroup) {
      view.scene.remove(overlayGroup);
      disposeGroup(overlayGroup);
    }
    // Dim the player's units that aren't actionable right now (spent or off-phase).
    const dim = new Set<number>();
    for (const u of livingUnits(state, playerSide)) if (u.controller === "player" && !readyToOrder(state, u)) dim.add(u.id);

    const board = buildBoard(state, { dim, selectedId });
    boardGroup = board.group;
    view.scene.add(boardGroup);
    markerGroups = boardGroup.children.filter((o) => o.userData.unitId !== undefined);
    terrainMesh = boardGroup.children.find((o) => o.name === "terrain") ?? null;

    overlayGroup = buildSelectionOverlays();
    view.scene.add(overlayGroup);

    if (!framed) {
      view.frame(board.min, board.max);
      framed = true;
    }
    renderCards();
    renderBar();
    renderHud();
  }

  function buildSelectionOverlays(): THREE.Group {
    const g = new THREE.Group();
    const o = currentOptions();
    const moveHexes: Hex[] = [];
    for (const key of o.moveKeys) moveHexes.push(o.reach.get(key)!.hex);
    if (moveHexes.length) g.add(buildHexOverlay(state, moveHexes, 0x4a90ff, 0.28));
    const targetHexes: Hex[] = [];
    for (const id of o.attack.keys()) {
      const e = livingUnits(state).find((u) => u.id === id);
      if (e) targetHexes.push(e.hex);
    }
    if (targetHexes.length) g.add(buildHexOverlay(state, targetHexes, 0xff5a4a, 0.42));
    const supplyHexes: Hex[] = [];
    for (const id of o.resupply) {
      const f = livingUnits(state).find((u) => u.id === id);
      if (f) supplyHexes.push(f.hex);
    }
    if (supplyHexes.length) g.add(buildHexOverlay(state, supplyHexes, 0x5ad06a, 0.4));
    return g;
  }

  // ── Click handling ─────────────────────────────────────────────────────────
  function onClick(ev: MouseEvent): void {
    if (state.outcome !== "ongoing") return;
    const rect = view.renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, view.camera);

    const clickedUnitId = pickUnit();
    const clickedHex = pickHex();
    // A click on a unit's ground hex (not its floating marker) still resolves to
    // that unit, so selecting by clicking the hex works too.
    const onHexUnit = clickedHex ? unitAt(state, clickedHex)?.id ?? null : null;
    const unitId = clickedUnitId ?? onHexUnit;

    const sel = selectedUnit();
    const o = sel && readyToOrder(state, sel) ? currentOptions() : EMPTY_OPTIONS;

    if (sel && unitId != null && o.attack.has(unitId)) {
      const target = livingUnits(state).find((u) => u.id === unitId)!;
      attackUnit(state, sel, o.attack.get(unitId)!, target);
    } else if (sel && unitId != null && o.resupply.has(unitId)) {
      const target = livingUnits(state).find((u) => u.id === unitId)!;
      resupplyUnit(state, sel, target);
    } else if (sel && clickedHex && o.moveKeys.has(hexKey(clickedHex)) && onHexUnit == null) {
      moveUnit(state, sel, pathTo(o.reach, hexKey(clickedHex)));
    } else if (unitId != null) {
      selectedId = unitId; // select (any unit can be inspected; only ready ones get orders)
    } else {
      selectedId = null; // clicked empty ground → deselect
    }
    checkOutcome();
    rebuild();
  }

  /** Nearest unit marker under the pointer, or null. */
  function pickUnit(): number | null {
    if (markerGroups.length === 0) return null;
    for (const hit of raycaster.intersectObjects(markerGroups, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.unitId !== undefined) return o.userData.unitId as number;
        o = o.parent;
      }
    }
    return null;
  }

  /** Hex under the pointer (raycast against the terrain surface), or null. */
  function pickHex(): Hex | null {
    if (!terrainMesh) return null;
    const hits = raycaster.intersectObject(terrainMesh, false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    return worldToHex(p.x, p.z, state.map.hexSize);
  }

  // ── Phase / turn flow ────────────────────────────────────────────────────────
  function endPhase(): void {
    if (state.outcome !== "ongoing") return;
    // The AI commands its units for this phase (both sides), then advance — the
    // same ordering as runMatch (player has already acted this phase).
    commandForce(state, "blue");
    commandForce(state, "red");
    if (checkOutcome()) {
      rebuild();
      return;
    }
    nextPhase(state);
    if (state.phase === "recon") previewIntents(state); // fresh turn → refresh banners
    checkOutcome();
    selectedId = null;
    rebuild();
  }

  function checkOutcome(): boolean {
    const o = evaluateOutcome(state);
    if (o !== "ongoing") state.outcome = o;
    return state.outcome !== "ongoing";
  }

  // ── DOM rendering ────────────────────────────────────────────────────────────
  function renderCards(): void {
    cardsEl.replaceChildren();
    for (const m of forceCards(state, playerSide)) cardsEl.appendChild(cardEl(m));
  }

  function cardEl(m: CardModel): HTMLElement {
    const el = document.createElement("div");
    el.className = "card" + (m.ready ? "" : " greyed") + (m.id === selectedId ? " selected" : "");
    el.style.setProperty("--side", m.side === "blue" ? "#4a90ff" : "#ff5a4a");
    const status = [m.shaken ? "⚠ shaken" : "", m.inSupply ? "" : "⛌ cut off"].filter(Boolean).join(" · ");
    el.innerHTML =
      `<div class="card-h"><span class="abbr">${m.abbr}</span><span class="nm">${m.name}</span>` +
      `<span class="tag">${m.controllable ? (m.ready ? "READY" : "—") : "AI"}</span></div>` +
      bar("STR", m.structureFrac, "#5ad06a") +
      bar("FUEL", m.fuelFrac, "#7fb0ff") +
      bar("AMMO", m.ammoFrac, "#e6c84a") +
      (m.intent ? `<div class="intent">▸ ${m.intent}</div>` : "") +
      (status ? `<div class="status">${status}</div>` : "");
    el.addEventListener("click", () => {
      selectedId = m.id;
      rebuild();
    });
    return el;
  }

  function renderBar(): void {
    barEl.replaceChildren();
    const info = document.createElement("div");
    info.className = "bar-info";
    const decided = state.outcome !== "ongoing";
    info.textContent = decided
      ? state.outcome === playerSide
        ? "OBJECTIVE SECURED"
        : "EFFORT FAILED"
      : `Turn ${state.turn}/${state.objective.turnLimit}  ·  ${state.phase.toUpperCase()} phase`;
    barEl.appendChild(info);

    const sel = selectedUnit();
    const hint = document.createElement("div");
    hint.className = "bar-hint";
    hint.textContent = decided
      ? ""
      : sel && readyToOrder(state, sel)
        ? "Click a blue hex to move · red enemy to fire · green ally to resupply"
        : "Select one of your support units (board or card)";
    barEl.appendChild(hint);

    if (!decided) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `End ${state.phase} phase ▸`;
      btn.addEventListener("click", endPhase);
      barEl.appendChild(btn);
    }
  }

  function renderHud(): void {
    if (!hudEl) return;
    const obj = state.objective;
    hudEl.innerHTML = `VANTAGE — ${state.map.name}&nbsp;&nbsp;·&nbsp;&nbsp;objective: ${obj.kind.toUpperCase()} (blue mechs)`;
  }

  view.renderer.domElement.addEventListener("click", onClick);
  rebuild();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function bar(label: string, frac: number, color: string): string {
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  return `<div class="meter"><span class="ml">${label}</span><span class="mt"><span class="mf" style="width:${pct}%;background:${color}"></span></span></div>`;
}

/** Set every AI unit's current intent (without acting) so banners/cards read on a
 *  fresh turn. decideUnit is pure — this mutates only state.intents. */
function previewIntents(state: GameState): void {
  const plans = { blue: planForce(state, "blue"), red: planForce(state, "red") };
  for (const u of livingUnits(state)) {
    if (u.controller !== "ai") continue;
    state.intents[u.id] = decideUnit(state, u, plans[u.side].tasks.get(u.id)).intent;
  }
}

function ensure(id: string): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}
