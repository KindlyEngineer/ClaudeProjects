import * as THREE from "three";
import type { View } from "../render/view";
import { hexSurfaceY } from "../render/board";
import { animating } from "../render/anim";
import { buildFacingPicker, buildHexLabels, buildHexOverlay } from "../render/overlay";
import { Stage, disposeGroup } from "../render/stage";
import type { Side } from "../data/types";
import { RULES } from "../data/rules";
import { moveUnit, attackUnit, faceUnit, resupplyUnit, fireMission, fortifyHex, layMinefield, clearMinefield, canFireMission, missionArea, type MissionKind } from "../sim/actions";
import { commandForce, decideUnit } from "../sim/ai";
import type { GameEvent } from "../sim/events";
import { commanderNeeds } from "../sim/needs";
import { callReconFlight, callStrike, canCallReconFlight, canCallStrike } from "../sim/offmap";
import { recordBattle, type OperationState } from "../sim/operation";
import { planForce } from "../sim/plan";
import { saveOperation } from "./persist";
import { buildAAR } from "./screens";
import { directionTo, hexDistance, hexEquals, hexKey, hexToWorld, neighbor, worldToHex, type Direction, type Hex } from "../sim/hex";
import { evaluateOutcome } from "../sim/objective";
import { pathTo, type ReachNode } from "../sim/pathing";
import { canMove, livingUnits, unitLabel, type GameState, type UnitInstance } from "../sim/state";
import { beginTurn, nextPhase } from "../sim/turn";
import {
  attackOptions,
  attackPreviews,
  canReserve,
  forceCards,
  fortifyTargets,
  mineTargets,
  clearTargets,
  inspectModel,
  moveOptions,
  readyToOrder,
  resupplyOptions,
  selectableUnitIdAt,
  supportActions,
  type CardModel,
  type InspectModel,
  type TerrainInfo,
} from "./control";

// The interactive controller — the human stand-in for the runMatch "player"
// policy. It drives the sim through ONLY the shared action API and only over the
// player's own units; the mechs and the enemy stay AI (commandForce). The board
// is an animated persistent STAGE rendered as the player's side sees it (fog of
// war), and every sim mutation is replayed from the EVENT STREAM: moves tween,
// shots trace and flash, kills leave wrecks, and the combat log scrolls — all
// fog-aware (you watch only what your side can see). Command follows BattleTech
// (2018): press-and-hold a destination, drag to aim the final facing, release
// to execute; holding the unit's own hex turns it in place; plain clicks fire /
// resupply / select. "End Phase" hands the phase to the AI for both sides and
// advances, mirroring runMatch's per-phase ordering.

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
  facing: Direction;
  rotate: boolean;
}

export function startInteractive(
  view: View,
  state: GameState,
  opts: { selectId?: number; playerSide?: Side; stage?: boolean; operation?: OperationState } = {},
): void {
  const playerSide: Side = opts.playerSide ?? "blue";
  let selectedId: number | null = opts.selectId ?? null;
  let pendingMove: PendingMove | null = null;
  let dragging = false; // mid press-drag-release facing gesture
  let inspectHex: Hex | null = null; // clicked empty ground → terrain inspection
  let notice: string | null = null; // why the last order didn't happen
  let playing = false; // event playback in progress → input parked
  let targeting: MissionKind | "fortify" | "mine" | "clearmines" | "strike" | "airrecon" | null = null; // a verb awaiting a target
  let hoverHex: Hex | null = null; // for the mission-area preview

  // Opening intents so the mech banners read on turn 1 (decideUnit is pure).
  beginTurn(state);
  previewIntents(state);

  const cardsEl = ensure("cards");
  const barEl = ensure("bar");
  const inspectEl = ensure("inspect");
  const logEl = ensure("log");
  const endEl = ensure("end");
  const needsEl = ensure("needs");
  const hudEl = document.getElementById("hud");

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // The persistent animated scene.
  const stage = new Stage(state);
  view.scene.add(stage.group);
  view.frame(stage.bounds.min, stage.bounds.max);
  let overlayGroup: THREE.Group | null = null;

  // Event stream cursor: everything before "now" becomes log history (no
  // animation for the opening upkeep), everything after plays back.
  let cursor = 0;
  const logLines: string[] = [];
  // An operation battle opens with the commander's Interlude refit report — what
  // it took from the depot and what it still wants.
  if (opts.operation?.refitReport.length) {
    logLines.push(`<div class="log-turn">— Interlude refit —</div>`);
    for (const line of opts.operation.refitReport) logLines.push(`<div class="log-line"><span class="log-us">${line}</span></div>`);
  }
  for (; cursor < state.events.length; cursor++) appendLog(state.events[cursor]);

  const selectedUnit = (): UnitInstance | undefined =>
    selectedId == null ? undefined : livingUnits(state).find((u) => u.id === selectedId);

  /** What the selected unit may do right now (empty unless it's the player's and
   *  ready). Built on the SAME pure helpers the tests cover (ui/control.ts). */
  function currentOptions(): Options {
    const u = selectedUnit();
    if (!u || !readyToOrder(state, u)) return EMPTY_OPTIONS;
    const reach = moveOptions(state, u);
    return { reach, moveKeys: new Set(reach.keys()), attack: attackOptions(state, u), resupply: resupplyOptions(state, u) };
  }

  /** Reconcile the stage + overlays + DOM with current state (no animation). */
  function refresh(): void {
    const dim = new Set<number>();
    for (const u of livingUnits(state, playerSide)) if (u.controller === "player" && !readyToOrder(state, u)) dim.add(u.id);
    stage.sync({ dim, selectedId, viewSide: playerSide });
    refreshOverlays();
    renderCards();
    renderInspect();
    renderHud();
    renderLog();
    renderNeeds();
    renderEnd();
  }

  function refreshOverlays(): void {
    if (overlayGroup) {
      view.scene.remove(overlayGroup);
      disposeGroup(overlayGroup);
    }
    overlayGroup = buildSelectionOverlays();
    view.scene.add(overlayGroup);
    renderBar();
  }

  /** Animate + log every event the sim appended since the last playback. */
  async function playback(): Promise<void> {
    playing = true;
    try {
      while (cursor < state.events.length) {
        const ev = state.events[cursor++];
        appendLog(ev);
        renderLog();
        await stage.play(ev);
      }
    } finally {
      playing = false;
    }
    refresh();
  }

  function afterAction(): void {
    checkOutcome();
    void playback();
  }

  function buildSelectionOverlays(): THREE.Group {
    const g = new THREE.Group();
    if (state.outcome !== "ongoing") return g;
    // While aiming a move (or a turn-in-place), the board shows only the
    // destination + the facing rosette, the aimed face tracking the mouse.
    if (pendingMove) {
      g.add(buildHexOverlay(state, [pendingMove.dest], 0xd8a03c, 0.4));
      g.add(buildFacingPicker(state, pendingMove.dest, pendingMove.facing));
      return g;
    }
    // A support verb is targeting: preview the footprint under the cursor
    // (missions / air), or light the buildable hexes (fortify).
    if (targeting) {
      const sel = selectedUnit();
      if (sel && targeting === "fortify") {
        g.add(buildHexOverlay(state, fortifyTargets(state, sel), 0xd8a03c, 0.4));
      } else if (sel && targeting === "mine") {
        g.add(buildHexOverlay(state, mineTargets(state, sel), 0xc4734a, 0.4));
      } else if (sel && targeting === "clearmines") {
        g.add(buildHexOverlay(state, clearTargets(state, sel), 0x8eb07a, 0.45));
      } else if (targeting === "strike" && hoverHex) {
        const ok = canCallStrike(state, playerSide, hoverHex).ok;
        const area = state.map.cells.filter((c) => hexDistance(c.hex, hoverHex!) <= RULES.offmap.strike.radius).map((c) => c.hex);
        g.add(buildHexOverlay(state, area, ok ? 0xc4554a : 0x4a4f55, ok ? 0.45 : 0.18));
      } else if (targeting === "airrecon" && hoverHex) {
        const ok = canCallReconFlight(state, playerSide, hoverHex).ok;
        const area = state.map.cells.filter((c) => hexDistance(c.hex, hoverHex!) <= RULES.offmap.reconFlight.radius).map((c) => c.hex);
        g.add(buildHexOverlay(state, area, ok ? 0x5d9ec9 : 0x4a4f55, ok ? 0.22 : 0.1));
      } else if (sel && hoverHex && (targeting === "suppress" || targeting === "smoke")) {
        const ok = canFireMission(state, sel, hoverHex, targeting).ok;
        const color = !ok ? 0x666c78 : targeting === "suppress" ? 0xc4734a : 0x8a9298;
        g.add(buildHexOverlay(state, missionArea(state, hoverHex), color, ok ? 0.4 : 0.18));
      }
      return g;
    }
    const sel = selectedUnit();
    const o = currentOptions();
    const moveHexes: Hex[] = [];
    for (const key of o.moveKeys) moveHexes.push(o.reach.get(key)!.hex);
    if (moveHexes.length) g.add(buildHexOverlay(state, moveHexes, 0x3d6f99, 0.30));
    const targetHexes: Hex[] = [];
    for (const id of o.attack.keys()) {
      const e = livingUnits(state).find((u) => u.id === id);
      if (e) targetHexes.push(e.hex);
    }
    if (targetHexes.length) g.add(buildHexOverlay(state, targetHexes, 0xc4554a, 0.42));
    // BattleTech-style hit-chance preview over each target.
    if (sel && targetHexes.length) {
      g.add(buildHexLabels(state, attackPreviews(state, sel).map((p) => ({ hex: p.hex, text: `${p.hitPct}%` }))));
    }
    const supplyHexes: Hex[] = [];
    for (const id of o.resupply) {
      const f = livingUnits(state).find((u) => u.id === id);
      if (f) supplyHexes.push(f.hex);
    }
    if (supplyHexes.length) g.add(buildHexOverlay(state, supplyHexes, 0x6a8e5d, 0.4));
    return g;
  }

  // ── Input: press-drag-release (BattleTech-style move + facing) ───────────────
  function setRay(ev: MouseEvent): void {
    const rect = view.renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, view.camera);
  }

  function onPointerDown(ev: MouseEvent): void {
    if (state.outcome !== "ongoing" || ev.button !== 0 || playing) return;
    pendingMove = null;
    notice = null;
    setRay(ev);
    const sel = selectedUnit();
    const o = sel && readyToOrder(state, sel) ? currentOptions() : EMPTY_OPTIONS;

    const pressedUnitId = pickUnit();
    const clickedHex = pickHex();

    // A verb is targeting: this click designates (or rejects) the target. Air
    // verbs are SIDE-level (no selected unit needed); the rest belong to `sel`.
    if (targeting) {
      if (!clickedHex) {
        targeting = null; // clicked off-board → cancel
        refreshOverlays();
        return;
      }
      let r: { ok: boolean; reason?: string } | null = null;
      if (targeting === "strike") r = callStrike(state, playerSide, clickedHex);
      else if (targeting === "airrecon") r = callReconFlight(state, playerSide, clickedHex);
      else if (sel && targeting === "fortify") r = fortifyHex(state, sel, clickedHex);
      else if (sel && targeting === "mine") r = layMinefield(state, sel, clickedHex);
      else if (sel && targeting === "clearmines") r = clearMinefield(state, sel, clickedHex);
      else if (sel && (targeting === "suppress" || targeting === "smoke")) r = fireMission(state, sel, clickedHex, targeting);
      if (r?.ok) {
        targeting = null;
        afterAction();
      } else if (r) {
        notice = r.reason ?? "invalid target"; // stay in targeting; let them re-aim
        renderBar();
      } else {
        targeting = null; // the owning unit vanished — drop the mode
        refreshOverlays();
      }
      return;
    }

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

    // Plain click: resolve against what the player KNOWS (fog-gated selection) —
    // plus anything the selected unit can legally SHOOT right now (attack options
    // come from live vision, which can run ahead of the per-turn belief refresh).
    const attackTargetAt =
      clickedHex == null
        ? null
        : ([...o.attack.keys()].find((id) => {
            const t = livingUnits(state).find((u) => u.id === id);
            return t !== undefined && hexEquals(t.hex, clickedHex);
          }) ?? null);
    const unitId = pressedUnitId ?? attackTargetAt ?? (clickedHex ? selectableUnitIdAt(state, playerSide, clickedHex) : null);
    if (sel && unitId != null && o.attack.has(unitId)) {
      const target = livingUnits(state).find((u) => u.id === unitId)!;
      const r = attackUnit(state, sel, o.attack.get(unitId)!, target);
      if (!r.fired) notice = "could not fire";
      afterAction();
      return;
    } else if (sel && unitId != null && o.resupply.has(unitId)) {
      const target = livingUnits(state).find((u) => u.id === unitId)!;
      const r = resupplyUnit(state, sel, target);
      if (!r.ok) notice = r.reason ?? "could not resupply";
      afterAction();
      return;
    } else if (unitId != null) {
      selectedId = unitId; // select (own units, or enemies where belief puts them)
      inspectHex = null;
      targeting = null;
    } else {
      selectedId = null; // pressed empty ground → deselect + inspect the terrain
      inspectHex = clickedHex;
      targeting = null;
    }
    refresh();
  }

  function onPointerMove(ev: MouseEvent): void {
    if (dragging && pendingMove) {
      setRay(ev);
      const f = facingTowardCursor(pendingMove.dest, pendingMove.facing);
      if (f !== pendingMove.facing) {
        pendingMove.facing = f;
        refreshOverlays();
      }
      return;
    }
    // Hover feedback (cheap): outline the hex, pointer-cursor over units; while
    // a mission targets, the footprint preview tracks the cursor.
    if (ev.target !== view.renderer.domElement || playing) return;
    setRay(ev);
    const h = pickHex();
    stage.setHover(h);
    if (targeting && targeting !== "fortify") {
      if ((h && !hoverHex) || (!h && hoverHex) || (h && hoverHex && !hexEquals(h, hoverHex))) {
        hoverHex = h;
        refreshOverlays();
      }
      view.renderer.domElement.style.cursor = "crosshair";
      return;
    }
    view.renderer.domElement.style.cursor = pickUnit() !== null ? "pointer" : "default";
  }

  function onPointerUp(ev: MouseEvent): void {
    if (!dragging) return;
    dragging = false;
    if (ev.button !== 0 || !pendingMove) {
      pendingMove = null;
      refresh();
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
    afterAction();
  }

  /** Stage a move to `dest` (route + initial facing = the travel direction). */
  function stageMove(o: Options, dest: Hex): PendingMove {
    const path = pathTo(o.reach, hexKey(dest));
    const from = path.length >= 2 ? path[path.length - 2] : selectedUnit()!.hex;
    return { dest, path, facing: directionTo(from, dest), rotate: false };
  }

  /** The hex face nearest the direction from `dest`'s centre to the cursor's
   *  point on the ground plane — how a drag aims the final facing. */
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
    const groups = stage.unitGroups();
    if (groups.length === 0) return null;
    for (const hit of raycaster.intersectObjects(groups, true)) {
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
    const hits = raycaster.intersectObject(stage.terrainMesh(), false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    return worldToHex(p.x, p.z, state.map.hexSize);
  }

  // ── Phase / turn flow ────────────────────────────────────────────────────────
  function endPhase(): void {
    if (state.outcome !== "ongoing" || playing) return;
    // The AI commands its units for this phase (both sides), then advance — the
    // same ordering as runMatch (player has already acted this phase).
    commandForce(state, "blue");
    commandForce(state, "red");
    if (!checkOutcome()) {
      nextPhase(state);
      if (state.phase === "recon") previewIntents(state); // fresh turn → refresh banners
      checkOutcome();
    }
    selectedId = null;
    pendingMove = null;
    dragging = false;
    inspectHex = null;
    notice = null;
    targeting = null;
    void playback();
  }

  function checkOutcome(): boolean {
    const o = evaluateOutcome(state);
    if (o !== "ongoing") state.outcome = o;
    return state.outcome !== "ongoing";
  }

  // ── Combat log (fog-honest: only what the player's side saw) ────────────────
  function name(id: number): string {
    const u = state.units.find((x) => x.id === id);
    if (!u) return "unknown";
    const chip = u.side === playerSide ? "log-us" : "log-them";
    return `<span class="${chip}">${unitLabel(u)}</span>`;
  }

  function appendLog(ev: GameEvent): void {
    if (ev.kind === "turn") {
      logLines.push(`<div class="log-turn">— Turn ${ev.n} —</div>`);
      return;
    }
    if (ev.kind === "phase") {
      logLines.push(`<div class="log-phase">· ${ev.phase} phase ·</div>`);
      return;
    }
    if (!eventVisible(ev)) return; // the fog hides it from the record too
    let text = "";
    if (ev.kind === "move") text = `${name(ev.id)} moves ${ev.path.length} hex${ev.path.length === 1 ? "" : "es"}`;
    else if (ev.kind === "face") text = `${name(ev.id)} turns in place`;
    else if (ev.kind === "mission") {
      text =
        ev.mission === "suppress"
          ? `${name(ev.id)} fires a suppression mission — <span class="log-pen">${ev.suppressedIds.length} unit${ev.suppressedIds.length === 1 ? "" : "s"} suppressed</span>`
          : `${name(ev.id)} lays a smoke screen`;
    } else if (ev.kind === "build") {
      text =
        ev.effect === "minefield"
          ? `${name(ev.id)} lays a minefield`
          : ev.effect === "minefield-cleared"
            ? `${name(ev.id)} breaches the minefield`
            : `${name(ev.id)} fortifies the position`;
    } else if (ev.kind === "mine") {
      text = `${name(ev.id)} strikes a mine — ${ev.destroyed ? '<span class="log-kill">DESTROYED</span>' : `<span class="log-pen">${ev.damage} dmg${ev.crit ? " · mobility out" : ""}</span>`}`;
    } else if (ev.kind === "offmap") {
      const chip = ev.side === playerSide ? "log-us" : "log-them";
      const who = `<span class="${chip}">${ev.side === playerSide ? "Your air" : "Enemy air"}</span>`;
      if (ev.asset === "strike") {
        const kills = ev.hits.filter((h) => h.destroyed).length;
        const dmg = ev.hits.reduce((s, h) => s + h.damage, 0);
        text = ev.intercepted
          ? `${who} strike <span class="log-pen">INTERCEPTED</span> — air defence drove it off`
          : `${who} strikes — ${ev.hits.length ? `${dmg} dmg${kills ? `, <span class="log-kill">${kills} DESTROYED</span>` : ""}` : "no effect on target"}`;
      } else {
        text = `${who} flies a recon pass — corridor observed`;
      }
    } else if (ev.kind === "resupply") {
      const parts = [ev.ammo > 0 ? `+${ev.ammo} ammo` : "", ev.fuel > 0 ? `+${ev.fuel} fuel` : ""].filter(Boolean).join(", ");
      text = `${name(ev.id)} resupplies ${name(ev.targetId)} (${parts || "topped up"})`;
    } else if (ev.kind === "fire") {
      const outcome = !ev.hit
        ? `<span class="log-miss">miss</span>`
        : ev.destroyed
          ? `<span class="log-kill">DESTROYED</span>`
          : ev.penetrated
            ? `<span class="log-pen">${ev.damage} dmg (${ev.arc})${ev.crit ? ` · crit: ${ev.crit}` : ""}</span>`
            : `deflected${ev.suppression ? ` · +${ev.suppression} supp` : ""}`;
      text = `${name(ev.id)} fires ${ev.weapon} at ${name(ev.targetId)} — ${outcome}`;
    }
    if (text) logLines.push(`<div class="log-line">${text}</div>`);
  }

  /** Could the player's side see this event happen? (Artillery missions and
   *  air activity are always noticed — loud and luminous.) */
  function eventVisible(ev: GameEvent): boolean {
    if (ev.kind === "move" || ev.kind === "face") return stage.shownLive(ev.id);
    if (ev.kind === "resupply") return stage.shownLive(ev.id) || stage.shownLive(ev.targetId);
    if (ev.kind === "fire") return stage.shownLive(ev.id) || stage.shownLive(ev.targetId);
    if (ev.kind === "build") return stage.shownLive(ev.id);
    if (ev.kind === "mine") return stage.shownLive(ev.id) || state.units.find((u) => u.id === ev.id)?.side === playerSide;
    return true;
  }

  function renderLog(): void {
    logEl.innerHTML = logLines.slice(-80).join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ── DOM rendering ────────────────────────────────────────────────────────────
  function renderCards(): void {
    const scroll = cardsEl.scrollLeft; // keep the strip where the player left it
    cardsEl.replaceChildren();
    for (const m of forceCards(state, playerSide)) cardsEl.appendChild(cardEl(m));
    cardsEl.scrollLeft = scroll;
  }

  const CRIT_LABEL: Record<string, string> = {
    mobility: "IMMOBILISED",
    weapon: "WEAPON OUT",
    sensors: "SENSORS HIT",
    shaken: "SHAKEN",
  };

  function cardEl(m: CardModel): HTMLElement {
    const el = document.createElement("div");
    el.className = "card" + (m.ready ? "" : " greyed") + (m.id === selectedId ? " selected" : "");
    el.style.setProperty("--side", m.side === "blue" ? "#5d9ec9" : "#c4554a");
    const status = [...m.crits.map((c) => CRIT_LABEL[c] ?? c), m.inSupply ? "" : "CUT OFF"].filter(Boolean).join(" · ");
    const tag = m.controllable ? (m.ready ? "READY" : m.reserved ? "RSV" : "—") : "AI";
    const nm = m.subtitle ? `${m.name}<span class="sub"> ${m.subtitle}</span>` : m.name;
    el.innerHTML =
      `<div class="card-h"><span class="abbr">${m.abbr}</span><span class="nm">${nm}</span>` +
      `<span class="tag">${tag}</span></div>` +
      bar("STR", m.structureFrac, "#7da06a") +
      bar("FUEL", m.fuelFrac, "#5d9ec9") +
      bar("AMMO", m.ammoFrac, "#d8a03c") +
      (m.suppressionFrac > 0 ? bar("SUP", m.suppressionFrac, "#c4734a") : "") +
      (m.intent ? `<div class="intent">▸ ${m.intent}</div>` : "") +
      (status ? `<div class="status">${status}</div>` : "");
    el.addEventListener("click", () => {
      if (playing) return;
      selectedId = m.id;
      pendingMove = null;
      inspectHex = null;
      refresh();
    });
    return el;
  }

  function renderBar(): void {
    barEl.replaceChildren();
    const info = document.createElement("div");
    info.className = "bar-info";
    const decided = state.outcome !== "ongoing";
    info.textContent = decided
      ? "BATTLE DECIDED"
      : `Turn ${state.turn}/${state.objective.turnLimit}  ·  ${state.phase.toUpperCase()} phase`;
    barEl.appendChild(info);

    const sel = selectedUnit();
    const hint = document.createElement("div");
    hint.className = notice ? "bar-hint bar-warn" : "bar-hint";
    hint.textContent = decided
      ? ""
      : notice
        ? `✕ ${notice}`
        : targeting
          ? targeting === "fortify"
            ? "Click a highlighted hex to fortify — Esc cancels"
            : targeting === "mine"
              ? "Click a highlighted hex to lay the minefield — Esc cancels"
              : targeting === "clearmines"
                ? "Click the hostile field to breach — Esc cancels"
            : targeting === "strike"
              ? "Click an OBSERVED hex to put the strike on — Esc cancels"
              : targeting === "airrecon"
                ? "Click where the overflight should look — Esc cancels"
                : `Click the ${targeting === "suppress" ? "suppression" : "smoke"} target hex — Esc cancels`
          : pendingMove
            ? pendingMove.rotate
              ? "Drag to turn in place — release to set the facing"
              : "Drag to aim the unit's final facing — release to confirm"
            : sel && readyToOrder(state, sel)
              ? "Hold a blue hex to move (drag to face) · hold the unit to turn · click red to fire, green to resupply"
              : "Select one of your support units (board or card) · right-drag pans, wheel zooms";
    barEl.appendChild(hint);

    if (!decided) {
      const mkBtn = (label: string, cls: string, onClick: () => void) => {
        const b = document.createElement("button");
        b.className = cls;
        b.textContent = label;
        b.addEventListener("click", onClick);
        barEl.appendChild(b);
      };
      if (targeting) {
        mkBtn("Cancel", "btn btn-alt", () => {
          targeting = null;
          notice = null;
          refreshOverlays();
        });
      } else {
        const enterTargeting = (t: MissionKind | "fortify" | "mine" | "clearmines" | "strike" | "airrecon") => () => {
          targeting = t;
          notice = null;
          hoverHex = null;
          refreshOverlays();
        };
        // Side-level air (no unit selection needed — the budget is the limiter).
        const air = state.offmap[playerSide];
        if (air.strike > 0) mkBtn(`Air Strike ×${air.strike}`, "btn btn-alt", enterTargeting("strike"));
        if (air.recon > 0) mkBtn(`Overflight ×${air.recon}`, "btn btn-alt", enterTargeting("airrecon"));
        // Support verbs for the selected unit (artillery missions / engineering).
        if (sel) {
          const sv = supportActions(state, sel);
          if (sv.missions) {
            mkBtn("Suppress", "btn btn-alt", enterTargeting("suppress"));
            mkBtn("Smoke", "btn btn-alt", enterTargeting("smoke"));
          }
          if (sv.fortify) mkBtn("Fortify", "btn btn-alt", enterTargeting("fortify"));
          if (sv.mine) mkBtn("Mine", "btn btn-alt", enterTargeting("mine"));
          if (sv.clear) mkBtn("Breach", "btn btn-alt", enterTargeting("clearmines"));
          if (canReserve(state, sel)) {
            mkBtn("Reserve", "btn btn-alt", () => {
              sel.reserved = true;
              selectedId = null;
              refresh();
            });
          }
        }
        mkBtn(`End ${state.phase} phase`, "btn", endPhase);
      }
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
      const status = [...c.crits.map((x) => CRIT_LABEL[x] ?? x), c.inSupply ? "" : "CUT OFF"].filter(Boolean).join(" · ");
      el.style.setProperty("--side", c.side === "blue" ? "#5d9ec9" : "#c4554a");
      el.innerHTML =
        `<div class="card-h"><span class="abbr">${c.abbr}</span><span class="nm">${c.name}</span><span class="tag">${c.controllable ? "YOURS" : "AI ALLY"}</span></div>` +
        bar("STR", c.structureFrac, "#7da06a") +
        bar("FUEL", c.fuelFrac, "#5d9ec9") +
        bar("AMMO", c.ammoFrac, "#d8a03c") +
        (c.suppressionFrac > 0 ? bar("SUP", c.suppressionFrac, "#c4734a") : "") +
        (status ? `<div class="status">${status}</div>` : "") +
        `<div class="comps">${m.components.map((x) => `<span class="${x.lost ? "comp-lost" : "comp-ok"}">${x.name}</span>`).join(" · ")}</div>` +
        (m.terrain ? `<div class="terrain">${terrainLine(m.terrain)}</div>` : "");
    } else if (m.kind === "enemy") {
      const fresh = m.live ? `<span class="live">IN SIGHT</span>` : `<span class="stale">last seen T${m.lastSeenTurn}</span>`;
      const status = m.crits.map((x) => CRIT_LABEL[x] ?? x).join(" · ");
      el.style.setProperty("--side", m.side === "blue" ? "#5d9ec9" : "#c4554a");
      el.innerHTML =
        `<div class="card-h"><span class="abbr">${m.abbr}</span><span class="nm">${m.name}</span><span class="tag">${fresh}</span></div>` +
        bar("STR", m.structureFrac, "#7da06a") +
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

  /** The commander's requests — what the autonomous main effort needs from YOU. */
  function renderNeeds(): void {
    needsEl.replaceChildren();
    if (state.outcome !== "ongoing") return;
    const needs = commanderNeeds(state, playerSide);
    if (needs.length === 0) return;
    const head = document.createElement("div");
    head.className = "needs-head";
    head.textContent = "COMMANDER";
    needsEl.appendChild(head);
    for (const n of needs.slice(0, 5)) {
      const line = document.createElement("div");
      line.className = n.urgency === "warn" ? "needs-line needs-warn" : "needs-line";
      line.textContent = `${n.urgency === "warn" ? "▲" : "▸"} ${n.text}`;
      needsEl.appendChild(line);
    }
  }

  function renderEnd(): void {
    if (state.outcome === "ongoing") {
      endEl.replaceChildren();
      return;
    }
    if (endEl.childElementCount > 0) return; // already shown
    // Operation battles end in the After-Action Report — the commander's word on
    // what the player's work meant — then the result is recorded and carried.
    if (opts.operation) {
      const op = opts.operation;
      endEl.appendChild(
        buildAAR(state, op, () => {
          recordBattle(op, state);
          saveOperation(op);
          location.href = `${location.pathname}?op=${op.defId}&${op.phase === "interlude" ? "interlude=1" : "battle=end"}`;
        }),
      );
      return;
    }
    const playerAttacks = state.objective.attacker === playerSide;
    const won = state.outcome === playerSide;
    const title = won ? (playerAttacks ? "OBJECTIVE SECURED" : "OBJECTIVE DEFENDED") : playerAttacks ? "EFFORT FAILED" : "OBJECTIVE LOST";
    const ownLost = state.units.filter((u) => u.side === playerSide && u.structure <= 0).length;
    const kills = stage.wreckCount(playerSide === "blue" ? "red" : "blue");
    const box = document.createElement("div");
    box.className = "end-box " + (won ? "end-win" : "end-loss");
    box.innerHTML =
      `<div class="end-title">${title}</div>` +
      `<div class="end-stats">turn ${Math.min(state.turn, state.objective.turnLimit)} of ${state.objective.turnLimit} · own losses ${ownLost} · confirmed kills ${kills}</div>`;
    const again = document.createElement("button");
    again.className = "btn";
    again.textContent = "Replay (same seed)";
    again.addEventListener("click", () => location.reload());
    const fresh = document.createElement("button");
    fresh.className = "btn btn-alt";
    fresh.textContent = "New seed";
    fresh.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("seed", String(Number(url.searchParams.get("seed") ?? 1) + 1));
      location.href = url.toString();
    });
    const row = document.createElement("div");
    row.className = "end-row";
    row.append(again, fresh);
    box.appendChild(row);
    endEl.appendChild(box);
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
      refresh();
    },
    moves: () => [...currentOptions().moveKeys],
    busy: () => playing || animating(),
    screenOf: (key: string) => {
      const [q, r] = key.split(",").map(Number);
      const w = hexToWorld({ q, r }, state.map.hexSize);
      const v = new THREE.Vector3(w.x, hexSurfaceY(state, { q, r }), w.z).project(view.camera);
      const rect = view.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    // Screen point to drag to in order to aim facing `dir` from `destKey` —
    // mirrors facingTowardCursor exactly (the neighbour's XZ at the destination's
    // plane height), so the e2e test isn't fooled by elevation projection shifts.
    aimScreen: (destKey: string, dir: Direction) => {
      const [q, r] = destKey.split(",").map(Number);
      const nb = hexToWorld(neighbor({ q, r }, dir), state.map.hexSize);
      const v = new THREE.Vector3(nb.x, hexSurfaceY(state, { q, r }), nb.z).project(view.camera);
      const rect = view.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
  };

  view.renderer.domElement.addEventListener("mousedown", onPointerDown);
  // Track drag + release on the window so a gesture that leaves the canvas (or
  // releases over a HUD element) still aims and commits correctly.
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (targeting) targeting = null; // back out of the support verb first…
    else if (pendingMove) (pendingMove = null), (dragging = false);
    else selectedId = null; // …then drop the selection
    notice = null;
    refresh();
  });
  view.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  refresh();
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
