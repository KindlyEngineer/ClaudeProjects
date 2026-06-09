import * as THREE from "three";
import { createView } from "./render/view";
import { tickAnimations } from "./render/anim";
import { buildBoard } from "./render/board";
import { addEffect } from "./sim/effects";
import { hexToWorld } from "./sim/hex";
import { createGame, livingUnits } from "./sim/state";
import { beginTurn } from "./sim/turn";
import { planForce } from "./sim/plan";
import { decideUnit } from "./sim/ai";
import { scriptedSkirmish } from "./sim/demo";
import { noSupport, playerSupport, runMatch } from "./sim/match";
import { unitType } from "./data/units";
import { startInteractive } from "./ui/interactive";
import { MAP01, MAP01_BREAKTHROUGH } from "./data/maps/map01";
import { MAP02 } from "./data/maps/map02";

// Boot. By default we hand the board to the interactive controller (the player
// commands their support echelon; the mechs and the enemy stay AI). A handful of
// URL modes instead render a fixed state for the self-verification harness:
// ?scenario=coreproof (run the proof to a result), ?demo=skirmish (scripted
// exchange). Turn-based, so there is no fixed-timestep sim loop — we render each
// animation frame for smooth camera/AA and on demand after each action.

const container = document.getElementById("app");
if (!container) throw new Error("#app not found");
const hud = document.getElementById("hud");

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed") ?? 1);

const view = createView(container);
const mapParam = params.get("map");
const map = mapParam === "breakthrough" ? MAP01_BREAKTHROUGH : mapParam === "steppe" ? MAP02 : MAP01;
const state = createGame(map, seed);

const headless = params.get("scenario") === "coreproof" || params.get("demo") === "skirmish";
if (params.get("scenario") === "coreproof") {
  // The core-proof match to a result. ?support=off → unsupported (mechs fail);
  // otherwise the full player support plan (mechs seize).
  const support = params.get("support") !== "off";
  runMatch(state, support ? playerSupport : noSupport);
} else if (params.get("demo") === "skirmish") {
  scriptedSkirmish(state, Number(params.get("turns") ?? 6));
}

if (headless) {
  // Static render of the resolved state for screenshot verification.
  beginTurn(state);
  const plans = { blue: planForce(state, "blue"), red: planForce(state, "red") };
  for (const m of livingUnits(state)) {
    if (m.controller !== "ai") continue;
    state.intents[m.id] = decideUnit(state, m, plans[m.side].tasks.get(m.id)).intent;
  }
  const board = buildBoard(state);
  view.scene.add(board.group);
  view.frame(new THREE.Vector3(board.min.x, board.min.y, board.min.z), new THREE.Vector3(board.max.x, board.max.y, board.max.z));
  if (hud) {
    const obj = state.objective;
    const header = [
      `VANTAGE — ${state.map.name}`,
      `turn ${state.turn}/${obj.turnLimit} · ${state.phase}`,
      `objective: ${obj.kind.toUpperCase()} (blue mechs)`,
    ].join("&nbsp;&nbsp;·&nbsp;&nbsp;");
    const intents = livingUnits(state, "blue")
      .filter((m) => unitType(m.typeId).cls === "mech")
      .map((m) => `▸ mech #${m.id}: ${state.intents[m.id] ?? "—"}`)
      .join("<br>");
    const result =
      state.outcome === "blue"
        ? `<br><b style="color:#7fd0ff">RESULT — BLUE SEIZED THE OBJECTIVE</b>`
        : state.outcome === "red"
          ? `<br><b style="color:#ff8a7a">RESULT — RED HELD · blue effort failed</b>`
          : "";
    hud.innerHTML = header + (intents ? `<br>${intents}` : "") + result;
  }
} else {
  // Interactive play. ?select=<id> pre-selects a unit (cards + movement range);
  // adding ?stage stages a move so the facing picker shows — both for screenshots.
  // ?fxdemo drops sample battlefield effects so the markers can be verified.
  if (params.has("fxdemo")) {
    const c = state.map.cells[Math.floor(state.map.cells.length / 2)].hex;
    addEffect(state, "smoke", c);
    addEffect(state, "smoke", { q: c.q, r: c.r + 1 });
    addEffect(state, "fortification", { q: c.q - 2, r: c.r });
  }
  const selectId = params.has("select") ? Number(params.get("select")) : undefined;
  startInteractive(view, state, { selectId, stage: params.has("stage") });
}

// ?focus=q,r&dist=N — frame the camera on a hex (close-up verification shots).
if (params.has("focus")) {
  const [q, r] = (params.get("focus") ?? "0,0").split(",").map(Number);
  const d = Number(params.get("dist") ?? 7);
  const w = hexToWorld({ q, r }, state.map.hexSize);
  view.frame(new THREE.Vector3(w.x - d, 0, w.z - d), new THREE.Vector3(w.x + d, 3, w.z + d));
}

window.addEventListener("resize", () => view.resize());

let frames = 0;
function loop(t: number): void {
  tickAnimations(t); // presentation tweens (movement, fire, floating text)
  view.tick(); // camera control damping
  view.render();
  if (++frames === 3) (window as unknown as { __vantageReady?: boolean }).__vantageReady = true;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
