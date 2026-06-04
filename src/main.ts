import * as THREE from "three";
import { createView } from "./render/view";
import { buildBoard } from "./render/board";
import { createGame } from "./sim/state";
import { updateSupply } from "./sim/logistics";
import { scriptedSkirmish } from "./sim/demo";
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
if (params.get("demo") === "skirmish") scriptedSkirmish(state, Number(params.get("turns") ?? 6));
else updateSupply(state);
const board = buildBoard(state);
view.scene.add(board.group);
view.frame(new THREE.Vector3(board.min.x, board.min.y, board.min.z), new THREE.Vector3(board.max.x, board.max.y, board.max.z));

if (hud) {
  const obj = state.objective;
  hud.innerHTML = [
    `VANTAGE — ${state.map.name}`,
    `turn ${state.turn}/${obj.turnLimit} · ${state.phase}`,
    `objective: ${obj.kind.toUpperCase()} (blue mechs)`,
  ].join("&nbsp;&nbsp;·&nbsp;&nbsp;");
}

window.addEventListener("resize", () => view.resize());

let frames = 0;
function loop(): void {
  view.render();
  if (++frames === 3) (window as unknown as { __vantageReady?: boolean }).__vantageReady = true;
  requestAnimationFrame(loop);
}
loop();
