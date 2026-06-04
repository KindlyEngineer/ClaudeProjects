import * as THREE from "three";
import { createView } from "./render/view";
import { buildBoard } from "./render/board";
import { createGame, livingUnits } from "./sim/state";
import { updateSupply } from "./sim/logistics";
import { decideMech } from "./sim/commander";
import { scriptedSkirmish } from "./sim/demo";
import { noSupport, playerSupport, redDefense, runMatch } from "./sim/match";
import { unitType } from "./data/units";
import { MAP01 } from "./data/maps/map01";

// Slice 1 boot: build the game state from a map and render the 2.5D board.
// Turn-based, so there is no fixed-timestep sim loop — we render on demand (and
// each animation frame for smooth camera/AA). Later slices add interaction.

const container = document.getElementById("app");
if (!container) throw new Error("#app not found");
const hud = document.getElementById("hud");

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed") ?? 1);

const view = createView(container);
const state = createGame(MAP01, seed);
// ?demo=skirmish runs a deterministic scripted exchange (so the capture shows
// movement + combat); otherwise just render the opening position.
if (params.get("scenario") === "coreproof") {
  // The core-proof match to a result. ?support=off → unsupported (mechs fail);
  // otherwise the full player support plan (mechs seize).
  const support = params.get("support") !== "off";
  runMatch(state, support ? playerSupport : noSupport, redDefense);
} else if (params.get("demo") === "skirmish") {
  scriptedSkirmish(state, Number(params.get("turns") ?? 6));
} else {
  updateSupply(state);
  // Surface each mech's opening commander intent on the static board too.
  for (const m of livingUnits(state)) {
    if (unitType(m.typeId).cls === "mech") state.intents[m.id] = decideMech(state, m).intent;
  }
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

window.addEventListener("resize", () => view.resize());

let frames = 0;
function loop(): void {
  view.render();
  if (++frames === 3) (window as unknown as { __vantageReady?: boolean }).__vantageReady = true;
  requestAnimationFrame(loop);
}
loop();
