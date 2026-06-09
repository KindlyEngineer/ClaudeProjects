import * as THREE from "three";
import type { View } from "../render/view";
import { buildBoard, hexSurfaceY } from "../render/board";
import { buildFacingPicker, buildHexLabels, buildHexOverlay } from "../render/overlay";
import type { Side } from "../data/types";
import { moveUnit, attackUnit, faceUnit, resupplyUnit } from "../sim/actions";
import { commandForce, decideUnit } from "../sim/ai";
import { planForce } from "../sim/plan";
import { directionTo, hexEquals, hexKey, hexToWorld, neighbor, worldToHex, type Direction, type Hex } from "../sim/hex";
import { evaluateOutcome } from "../sim/objective";
import { pathTo, type ReachNode } from "../sim/pathing";
import { canMove, livingUnits, type GameState, type UnitInstance } from "../sim/state";
import { beginTurn, nextPhase } from "../sim/turn";
import {
  attackOptions,
  attackPreviews,
  canReserve,
  forceCards,
  inspectModel,
  moveOptions,
  readyToOrder,
  resupplyOptions,
  selectableUnitIdAt,
  type CardModel,
  type InspectModel,
  type TerrainInfo,
} from "./control";

// The interactive controller — the human stand-in for the runMatch "player"
// policy. It drives the sim through ONLY the shared action API and only over the
// player's own units; the mechs and the enemy stay AI (commandForce). The board
// is rendered AS THE PLAYER'S SIDE SEES IT (fog of war): enemies appear only
// where the side's belief puts them. Command follows BattleTech (2018): pick a
// unit (board marker or card), its reachable hexes light up; PRESS-AND-HOLD a
// destination, DRAG to aim which hex face the unit ends up fronting, RELEASE to
// lock it in and execute. Holding the unit's OWN hex turns it in place. A plain
// click on an enemy fires (hit% is previewed over each target); on a friendly
// (supply) resupplies; on a unit selects it. "End Phase" hands the phase to the
// AI for both sides and advances, mirroring runMatch's per-phase ordering
// (player acts, then commandForce blue/red, then nextPhase).

interface Options {
  reach: Map<string, ReachNode>;
  moveKeys: Set<string>; // reachable destination hexKeys (excludes current)
  attack: Map<number, number>; // enemy id → weapon index
  resupply: Set<number>; // friendly ids resuppliable now
}

const EMPTY_OPTIONS: Options = { reach: new Map(), moveKeys: new Set(), attack: new Map(), resupply: new Set() };

// A move being aimed: destination + route are fixed; `facing` tracks the mouse
// live during the press-drag and is the value committed on release. `rotate`
// marks a turn-in-place (same hex, facing only).
interface PendingMove {
  dest: Hex;
  path: Hex[];
  facing: Direction; // current aimed facing (starts at the travel direction)
  rotate: boolean;
}

export function startInteractive(view: View, state: GameState, opts: { selectId?: number; playerSide?: Side; stage?: boolean } = {}): void {
  const playerSide: Side = opts.playerSide ?? "blue";
  let selectedId: number | null = opts.selectId ?? null;
  let pendingMove: PendingMove | null = null;
  let dragging = false; // mid press-drag-release facing gesture
  let inspectHex: Hex | null = null; // clicked empty ground → terrain inspection
  let notice: string | null = null; // why the last order didn't happen
  let framed = false;

  // Opening intents so the mech banners read on turn 1 (decideUnit is pure).
  beginTurn(state);
  previewIntents(state);

  const cardsEl = ensure("cards");
  const barEl = ensure("bar");
  const inspectEl = ensure("inspect");
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
   *  ready). Built on the SAME pure helpers the tests cover (ui/control.ts), so
   *  the running UI can't drift from the tested rules. */
  function currentOptions(): Options {
    const u = selectedUnit();
    if (!u || !readyToOrder(state, u)) return EMPTY_OPTIONS;
    const reach = moveOptions(state, u);
    return { reach, moveKeys: new Set(reach.keys()), attack: attackOptions(state, u), resupply: resupplyOptions(state, u) };
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

    const board = buildBoard(state, { dim, selectedId, viewSide: playerSide });
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
    renderInspect();
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
    // While aiming a move (or a turn-in-place), the board shows only the
    // destination + the facing rosette, the aimed face tracking the mouse.
    if (pendingMove) {
      g.add(buildHexOverlay(state, [pendingMove.dest], 0xffe66a, 0.4));
      g.add(buildFacingPicker(state, pendingMove.dest, pendingMove.facing));
      return g;
    }
    const sel = selectedUnit();
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
    // BattleTech-style hit-chance preview over each target.
    if (sel && targetHexes.length) {
      g.add(buildHexLabels(state, attackPreviews(state, sel).map((p) => ({ hex: p.hex, text: `${p.hitPct}%` }))));
    }
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

  /** Press: on a reachable hex (with a ready unit) begin aiming a move; on the
   *  unit's own hex begin a turn-in-place; otherwise fire / resupply / select /
   *  deselect immediately (a plain click). */
  function onPointerDown(ev: MouseEvent): void {
    if (state.outcome !== "ongoing" || ev.button !== 0) return;
    pendingMove = null; // clear any stale (e.g. screenshot-staged) aim
    notice = null;
    setRay(ev);
    const sel = selectedUnit();
    const o = sel && readyToOrder(state, sel) ? currentOptions() : EMPTY_OPTIONS;

    const pressedUnitId = pickUnit();
    const clickedHex = pickHex();

    // Begin a TURN-IN-PLACE when pressing the selected unit itself (its marker
    // or its hex) — drag aims the new facing, release commits it as the move.
    if (
      sel &&
      readyToOrder(state, sel) &&
      !sel.movedThisTurn &&
      canMove(sel) &&
      (pressedUnitId === sel.id || (clickedHex !== null && hexEquals(clickedHex, sel.hex)))
    ) {
      ev.preventDefault();
      pendingMove = { dest: sel.hex, path: [], facing: sel.facing, rotate: true };
      dragging = true;
      refreshOverlays();
      return;
    }

    // Begin the MOVE gesture when pressing an empty reachable hex.
    if (sel && clickedHex && o.moveKeys.has(hexKey(clickedHex))) {
      ev.preventDefault();
      pendingMove = stageMove(o, clickedHex);
      dragging = true;
      refreshOverlays();
      return;
    }

    // Plain click: resolve against what the player KNOWS (fog-gated selection).
    const unitId = pressedUnitId ?? (clickedHex ? selectableUnitIdAt(state, playerSide, clickedHex) : null);
    if (sel && unitId != null && o.attack.has(unitId)) {
      const target = livingUnits(state).find((u) => u.id === unitId)!;
      const r = attackUnit(state, sel, o.attack.get(unitId)!, target);
      if (!r.fired) notice = "could not fire";
    } else if (sel && unitId != null && o.resupply.has(unitId)) {
      const target = livingUnits(state).find((u) => u.id === unitId)!;
      const r = resupplyUnit(state, sel, target);
      if (!r.ok) notice = r.reason ?? "could not resupply";
    } else if (unitId != null) {
      selectedId = unitId; // select (own units, or enemies where belief puts them)
      inspectHex = null;
    } else {
      selectedId = null; // pressed empty ground → deselect + inspect the terrain
      inspectHex = clickedHex;
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

  /** Release: lock in the aimed facing and execute the move / turn-in-place. */
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
    if (sel) {
      if (pendingMove.rotate) {
        // Releasing on the same facing = no order (the press was just a click).
        if (pendingMove.facing !== sel.facing) {
          const r = faceUnit(state, sel, pendingMove.facing);
          if (!r.moved) notice = r.reason ?? "could not turn";
        }
      } else {
        const r = moveUnit(state, sel, pendingMove.path, pendingMove.facing);
        if (!r.moved) notice = r.reason ?? "could not move";
      }
    }
    pendingMove = null;
    checkOutcome();
    rebuild();
  }

  /** Stage a move to `dest` (route + initial facing = the travel direction). */
  function stageMove(o: Options, dest: Hex): PendingMove {
    const path = pathTo(o.reach, hexKey(dest));
    const from = path.length >= 2 ? path[path.length - 2] : selectedUnit()!.hex;
    return { dest, path, facing: directionTo(from, dest), rotate: false };
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
    inspectHex = null;
    notice = null;
    rebuild();
  }

  function checkOutcome(): boolean {
    const o = evaluateOutcome(state);
    if (o !== "ongoing") state.outcome = o;
    return state.outcome !== "ongoing";
  }

  // ── DOM rendering ────────────────────────────────────────────────────────────
  function renderCards(): void {
    const scroll = cardsEl.scrollLeft; // keep the strip where the player left it
    cardsEl.replaceChildren();
    for (const m of forceCards(state, playerSide)) cardsEl.appendChild(cardEl(m));
    cardsEl.scrollLeft = scroll;
  }

  const CRIT_LABEL: Record<string, string> = {
    mobility: "⚙ immobilised",
    weapon: "✕ weapon out",
    sensors: "◌ sensors hit",
    shaken: "⚠ shaken",
  };

  function cardEl(m: CardModel): HTMLElement {
    const el = document.createElement("div");
    el.className = "card" + (m.ready ? "" : " greyed") + (m.id === selectedId ? " selected" : "");
    el.style.setProperty("--side", m.side === "blue" ? "#4a90ff" : "#ff5a4a");
    const status = [...m.crits.map((c) => CRIT_LABEL[c] ?? c), m.inSupply ? "" : "⛌ cut off"].filter(Boolean).join(" · ");
    const tag = m.controllable ? (m.ready ? "READY" : m.reserved ? "RSV" : "—") : "AI";
    el.innerHTML =
      `<div class="card-h"><span class="abbr">${m.abbr}</span><span class="nm">${m.name}</span>` +
      `<span class="tag">${tag}</span></div>` +
      bar("STR", m.structureFrac, "#5ad06a") +
      bar("FUEL", m.fuelFrac, "#7fb0ff") +
      bar("AMMO", m.ammoFrac, "#e6c84a") +
      (m.suppressionFrac > 0 ? bar("SUP", m.suppressionFrac, "#ff8a4a") : "") +
      (m.intent ? `<div class="intent">▸ ${m.intent}</div>` : "") +
      (status ? `<div class="status">${status}</div>` : "");
    el.addEventListener("click", () => {
      selectedId = m.id;
      pendingMove = null;
      inspectHex = null;
      rebuild();
    });
    return el;
  }

  function renderBar(): void {
    barEl.replaceChildren();
    const info = document.createElement("div");
    info.className = "bar-info";
    const decided = state.outcome !== "ongoing";
    const playerAttacks = state.objective.attacker === playerSide;
    info.textContent = decided
      ? state.outcome === playerSide
        ? playerAttacks
          ? "OBJECTIVE SECURED"
          : "OBJECTIVE DEFENDED"
        : playerAttacks
          ? "EFFORT FAILED — objective not taken"
          : "OBJECTIVE LOST"
      : `Turn ${state.turn}/${state.objective.turnLimit}  ·  ${state.phase.toUpperCase()} phase`;
    barEl.appendChild(info);

    const sel = selectedUnit();
    const hint = document.createElement("div");
    hint.className = notice ? "bar-hint bar-warn" : "bar-hint";
    hint.textContent = decided
      ? ""
      : notice
        ? `✕ ${notice}`
        : pendingMove
          ? pendingMove.rotate
            ? "Drag to turn in place — release to set the facing"
            : "Drag to aim the unit's final facing — release to confirm"
          : sel && readyToOrder(state, sel)
            ? "Hold a blue hex to move (drag to face) · hold the unit to turn · click red to fire, green to resupply"
            : "Select one of your support units (board or card)";
    barEl.appendChild(hint);

    if (!decided) {
      // Hold a unit out of its home phase to commit in the maneuver phase instead.
      if (sel && canReserve(state, sel)) {
        const rsv = document.createElement("button");
        rsv.className = "btn btn-alt";
        rsv.textContent = "Hold in reserve";
        rsv.addEventListener("click", () => {
          sel.reserved = true;
          selectedId = null;
          rebuild();
        });
        barEl.appendChild(rsv);
      }
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `End ${state.phase} phase ▸`;
      btn.addEventListener("click", endPhase);
      barEl.appendChild(btn);
    }
  }

  function terrainLine(t: TerrainInfo): string {
    const losNote = t.blocksLineOfSight ? " · blocks LOS" : "";
    const move = Number.isFinite(t.moveCost) ? `move ${t.moveCost}` : "impassable";
    return `${t.name} · cover ${t.cover} · ${move}${losNote} · elev ${t.elevation.toFixed(1)} (visual)`;
  }

  function renderInspect(): void {
    inspectEl.replaceChildren();
    const m: InspectModel = inspectModel(state, playerSide, selectedId, inspectHex);
    if (!m) return;
    const el = document.createElement("div");
    el.className = "inspect-body";
    if (m.kind === "own") {
      const c = m.card;
      const status = [...c.crits.map((x) => CRIT_LABEL[x] ?? x), c.inSupply ? "" : "⛌ cut off"].filter(Boolean).join(" · ");
      el.style.setProperty("--side", c.side === "blue" ? "#4a90ff" : "#ff5a4a");
      el.innerHTML =
        `<div class="card-h"><span class="abbr">${c.abbr}</span><span class="nm">${c.name}</span><span class="tag">${c.controllable ? "YOURS" : "AI ALLY"}</span></div>` +
        bar("STR", c.structureFrac, "#5ad06a") +
        bar("FUEL", c.fuelFrac, "#7fb0ff") +
        bar("AMMO", c.ammoFrac, "#e6c84a") +
        (c.suppressionFrac > 0 ? bar("SUP", c.suppressionFrac, "#ff8a4a") : "") +
        (status ? `<div class="status">${status}</div>` : "") +
        (m.terrain ? `<div class="terrain">${terrainLine(m.terrain)}</div>` : "");
    } else if (m.kind === "enemy") {
      const fresh = m.live ? `<span class="live">IN SIGHT</span>` : `<span class="stale">last seen T${m.lastSeenTurn}</span>`;
      const status = m.crits.map((x) => CRIT_LABEL[x] ?? x).join(" · ");
      el.style.setProperty("--side", m.side === "blue" ? "#4a90ff" : "#ff5a4a");
      el.innerHTML =
        `<div class="card-h"><span class="abbr">${m.abbr}</span><span class="nm">${m.name}</span><span class="tag">${fresh}</span></div>` +
        bar("STR", m.structureFrac, "#5ad06a") +
        (status ? `<div class="status">${status}</div>` : "") +
        (m.terrain ? `<div class="terrain">${terrainLine(m.terrain)}</div>` : "") +
        `<div class="foot">known position — intel, not ground truth</div>`;
    } else {
      el.innerHTML = `<div class="card-h"><span class="nm">Terrain</span></div><div class="terrain">${terrainLine(m.terrain)}</div>`;
    }
    inspectEl.appendChild(el);
  }

  function renderHud(): void {
    if (!hudEl) return;
    const obj = state.objective;
    hudEl.innerHTML = `VANTAGE — ${state.map.name}&nbsp;&nbsp;·&nbsp;&nbsp;${obj.kind.toUpperCase()} — attacker ${obj.attacker.toUpperCase()} · you run ${playerSide.toUpperCase()} support`;
  }

  // ?stage pre-positions a move (farthest reachable hex) so a screenshot can show
  // the facing picker without a synthetic click.
  if (opts.stage) {
    const u = selectedUnit();
    if (u && readyToOrder(state, u)) {
      const o = currentOptions();
      let far: string | null = null;
      let best = -1;
      for (const [k, node] of o.reach) if (node.cost > best) (best = node.cost), (far = k);
      if (far) pendingMove = stageMove(o, o.reach.get(far)!.hex);
    }
  }

  // Introspection hook for the end-to-end gesture test (tools/uitest.ts): live
  // state plus screen-space projection so a real mouse drag can be driven.
  (window as unknown as { __vantage?: unknown }).__vantage = {
    state,
    select: (id: number) => {
      selectedId = id;
      rebuild();
    },
    moves: () => [...currentOptions().moveKeys],
    screenOf: (key: string) => {
      const [q, r] = key.split(",").map(Number);
      const w = hexToWorld({ q, r }, state.map.hexSize);
      const v = new THREE.Vector3(w.x, hexSurfaceY(state, { q, r }), w.z).project(view.camera);
      const rect = view.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
  };

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

/** Free GPU resources for a discarded group. Disposing a material does NOT
 *  dispose its texture, and every badge/banner/label is a fresh CanvasTexture —
 *  without this, each rebuild leaks GPU textures. */
function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // Sprites share one module-level geometry across ALL sprites — never dispose it.
    if (mesh.geometry && !(o instanceof THREE.Sprite)) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const map = (m as THREE.Material & { map?: THREE.Texture | null }).map;
      if (map) map.dispose();
      m.dispose();
    }
  });
}
