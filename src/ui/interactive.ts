import * as THREE from "three";
import type { View } from "../render/view";
import { buildBoard, hexSurfaceY } from "../render/board";
import { buildFacingPicker, buildHexOverlay } from "../render/overlay";
import type { Side } from "../data/types";
import { moveUnit, attackUnit, resupplyUnit } from "../sim/actions";
import { commandForce, decideUnit } from "../sim/ai";
import { planForce } from "../sim/plan";
import { directionTo, hexKey, hexToWorld, neighbor, worldToHex, type Direction, type Hex } from "../sim/hex";
import { evaluateOutcome } from "../sim/objective";
import { pathTo, reachable, type ReachNode } from "../sim/pathing";
import { livingUnits, unitAt, type GameState, type UnitInstance } from "../sim/state";
import { beginTurn, nextPhase } from "../sim/turn";
import { attackOptions, forceCards, readyToOrder, resupplyOptions, type CardModel } from "./control";

// The interactive controller — the human stand-in for the runMatch "player"
// policy. It drives the sim through ONLY the shared action API and only over the
// player's own units; the mechs and the enemy stay AI (commandForce). Command
// follows BattleTech (2018): pick a unit (board marker or card), its reachable
// hexes light up; PRESS-AND-HOLD a destination, DRAG to aim which hex face the
// unit ends up fronting, and RELEASE to lock it in and execute the move. A plain
// click (no drag) on an enemy fires; on a friendly (supply) resupplies; on a
// unit selects it. "End Phase" hands the phase to the AI for both sides and
// advances, mirroring runMatch's per-phase ordering (player acts, then
// commandForce blue/red, then nextPhase).

interface Options {
  reach: Map<string, ReachNode>;
  moveKeys: Set<string>; // reachable destination hexKeys (excludes current)
  attack: Map<number, number>; // enemy id → weapon index
  resupply: Set<number>; // friendly ids resuppliable now
}

const EMPTY_OPTIONS: Options = { reach: new Map(), moveKeys: new Set(), attack: new Map(), resupply: new Set() };

// A move being aimed: destination + route are fixed; `facing` tracks the mouse
// live during the press-drag and is the value committed on release.
interface PendingMove {
  dest: Hex;
  path: Hex[];
  facing: Direction; // current aimed facing (starts at the travel direction)
}

export function startInteractive(view: View, state: GameState, opts: { selectId?: number; playerSide?: Side; stage?: boolean } = {}): void {
  const playerSide: Side = opts.playerSide ?? "blue";
  let selectedId: number | null = opts.selectId ?? null;
  let pendingMove: PendingMove | null = null;
  let dragging = false; // mid press-drag-release facing gesture
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

  /** Rebuild ONLY the overlay group (cheap) — used while dragging the facing so
   *  the board geometry/cards aren't re-created on every mouse move. */
  function refreshOverlays(): void {
    if (overlayGroup) {
      view.scene.remove(overlayGroup);
      disposeGroup(overlayGroup);
    }
    overlayGroup = buildSelectionOverlays();
    view.scene.add(overlayGroup);
    renderBar();
  }

  function buildSelectionOverlays(): THREE.Group {
    const g = new THREE.Group();
    // While aiming a move, the board shows only the destination + the facing
    // rosette, with the currently aimed face highlighted (it tracks the mouse).
    if (pendingMove) {
      g.add(buildHexOverlay(state, [pendingMove.dest], 0xffe66a, 0.4));
      g.add(buildFacingPicker(state, pendingMove.dest, pendingMove.facing));
      return g;
    }
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

  // ── Input: press-drag-release (BattleTech-style move + facing) ───────────────
  function setRay(ev: MouseEvent): void {
    const rect = view.renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, view.camera);
  }

  /** Press: on a reachable hex (with a ready unit) begin aiming a move; otherwise
   *  fire / resupply / select / deselect immediately (a plain click). */
  function onPointerDown(ev: MouseEvent): void {
    if (state.outcome !== "ongoing" || ev.button !== 0) return;
    pendingMove = null; // clear any stale (e.g. screenshot-staged) aim
    setRay(ev);
    const sel = selectedUnit();
    const o = sel && readyToOrder(state, sel) ? currentOptions() : EMPTY_OPTIONS;

    const clickedHex = pickHex();
    // Begin the move-aim gesture when pressing an empty reachable hex.
    if (sel && clickedHex && o.moveKeys.has(hexKey(clickedHex)) && unitAt(state, clickedHex) == null) {
      ev.preventDefault();
      pendingMove = stageMove(o, clickedHex);
      dragging = true;
      refreshOverlays();
      return;
    }

    const unitId = pickUnit() ?? (clickedHex ? unitAt(state, clickedHex)?.id ?? null : null);
    if (sel && unitId != null && o.attack.has(unitId)) {
      attackUnit(state, sel, o.attack.get(unitId)!, livingUnits(state).find((u) => u.id === unitId)!);
    } else if (sel && unitId != null && o.resupply.has(unitId)) {
      resupplyUnit(state, sel, livingUnits(state).find((u) => u.id === unitId)!);
    } else if (unitId != null) {
      selectedId = unitId; // select (any unit can be inspected; only ready ones get orders)
    } else {
      selectedId = null; // pressed empty ground → deselect
    }
    checkOutcome();
    rebuild();
  }

  /** Drag: aim the final facing toward the cursor (snap to the nearest hex face). */
  function onPointerMove(ev: MouseEvent): void {
    if (!dragging || !pendingMove) return;
    setRay(ev);
    const f = facingTowardCursor(pendingMove.dest, pendingMove.facing);
    if (f !== pendingMove.facing) {
      pendingMove.facing = f;
      refreshOverlays();
    }
  }

  /** Release: lock in the aimed facing and execute the move. */
  function onPointerUp(ev: MouseEvent): void {
    if (!dragging) return;
    dragging = false;
    if (ev.button !== 0 || !pendingMove) {
      pendingMove = null;
      rebuild();
      return;
    }
    setRay(ev);
    pendingMove.facing = facingTowardCursor(pendingMove.dest, pendingMove.facing);
    const sel = selectedUnit();
    if (sel) moveUnit(state, sel, pendingMove.path, pendingMove.facing);
    pendingMove = null;
    checkOutcome();
    rebuild();
  }

  /** Stage a move to `dest` (route + initial facing = the travel direction). */
  function stageMove(o: Options, dest: Hex): PendingMove {
    const path = pathTo(o.reach, hexKey(dest));
    const from = path.length >= 2 ? path[path.length - 2] : selectedUnit()!.hex;
    return { dest, path, facing: directionTo(from, dest) };
  }

  /** The hex face nearest the direction from `dest`'s centre to the cursor's
   *  point on the ground plane — how a drag aims the final facing. Falls back to
   *  `current` when the cursor is right over the centre (no clear direction). */
  function facingTowardCursor(dest: Hex, current: Direction): Direction {
    const size = state.map.hexSize;
    const c = hexToWorld(dest, size);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hexSurfaceY(state, dest));
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return current;
    const dx = hit.x - c.x;
    const dz = hit.z - c.z;
    if (dx * dx + dz * dz < (size * 0.2) ** 2) return current; // too close to aim
    let best: Direction = current;
    let bestDot = -Infinity;
    for (let d = 0; d < 6; d++) {
      const nb = hexToWorld(neighbor(dest, d as Direction), size);
      const ndx = nb.x - c.x;
      const ndz = nb.z - c.z;
      const len = Math.hypot(ndx, ndz) || 1;
      const dot = (dx * ndx + dz * ndz) / len;
      if (dot > bestDot) {
        bestDot = dot;
        best = d as Direction;
      }
    }
    return best;
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
    pendingMove = null;
    dragging = false;
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
      pendingMove = null;
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
      : pendingMove
        ? "Drag to aim the unit's final facing — release to confirm"
        : sel && readyToOrder(state, sel)
          ? "Press & hold a blue hex then drag to face · click a red enemy to fire · green ally to resupply"
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

  // ?stage pre-positions a move (farthest reachable hex) so a screenshot can show
  // the facing picker without a synthetic click.
  if (opts.stage) {
    const u = selectedUnit();
    if (u && readyToOrder(state, u)) {
      const o = currentOptions();
      let far: string | null = null;
      let best = -1;
      for (const [k, node] of o.reach) if (node.prev !== null && node.cost > best) (best = node.cost), (far = k);
      if (far) pendingMove = stageMove(o, o.reach.get(far)!.hex);
    }
  }

  view.renderer.domElement.addEventListener("mousedown", onPointerDown);
  // Track drag + release on the window so a gesture that leaves the canvas (or
  // releases over a HUD element) still aims and commits correctly.
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  view.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
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
