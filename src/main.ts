import * as THREE from "three";
import { createView } from "./render/view";
import { tickAnimations } from "./render/anim";
import { buildBoard } from "./render/board";
import { addEffect } from "./sim/effects";
import { hexToWorld } from "./sim/hex";
import { createGame, livingUnits, type GameState } from "./sim/state";
import { beginTurn } from "./sim/turn";
import { planForce } from "./sim/plan";
import { decideUnit } from "./sim/ai";
import { scriptedSkirmish } from "./sim/demo";
import { noSupport, playerSupport, runMatch } from "./sim/match";
import { buySupport, createOperation, finishInterlude, prepareBattle, type OperationState } from "./sim/operation";
import { unitType } from "./data/units";
import { startInteractive } from "./ui/interactive";
import { loadOperation } from "./ui/persist";
import { renderInterlude, renderMenu, renderOperationEnd } from "./ui/screens";
import { MAP01, MAP01_BREAKTHROUGH } from "./data/maps/map01";
import { MAP02 } from "./data/maps/map02";
import { MAP03 } from "./data/maps/map03";
import { MAP04 } from "./data/maps/map04";
import { MAP05 } from "./data/maps/map05";
import { MAP06 } from "./data/maps/map06";
import { randomSkirmishMap, type ForcePreset } from "./data/maps/gen";

// Boot router (M1). Routes by URL so every page loads deterministically:
//   (no params)            → the title menu
//   ?op=…&interlude=1      → the Interlude (between-battles logistics stage)
//   ?op=…&battle=N         → an operation battle (carry-over injected)
//   ?map=…&seed=N          → a skirmish battle
//   ?scenario= / ?demo=    → static headless renders for the verification harness
// Battle pages keep every existing harness param (?select/?stage/?fxdemo/?focus).

const container = document.getElementById("app");
if (!container) throw new Error("#app not found");
const hud = document.getElementById("hud");
const params = new URLSearchParams(location.search);

const setReady = (): void => {
  (window as unknown as { __vantageReady?: boolean }).__vantageReady = true;
};

// ── DOM-only routes (no renderer) ────────────────────────────────────────────
const opParam = params.get("op");
const operation: OperationState | null = opParam ? loadOperation() : null;
const battleParams = params.has("map") || params.has("battle") || params.has("scenario") || params.has("demo") || params.has("select") || params.has("deploydemo");

if (params.has("opdemo")) {
  // Verification route: a mid-operation Interlude built in memory (battle one
  // won at a price) so the screenshot harness can see the screen without a save.
  if (hud) hud.remove();
  const demo = createOperation("op01", 7);
  demo.battleIndex = 1;
  demo.history.push({ title: "Battle I — Ridge Approach", won: true, turns: 11, mechsLost: [] });
  const mech = demo.roster.find((r) => r.callSign)!;
  mech.structure = 12;
  mech.componentsLost = ["sensors"];
  mech.crits = ["sensors"];
  for (const t of ["recon", "artillery", "supply"]) buySupport(demo, t);
  demo.roster.find((r) => r.typeId === "recon")!.committed = true; // a veteran — no disbanding
  renderInterlude(document.body, demo);
  setReady();
} else if (!battleParams && !params.has("interlude") && !opParam) {
  if (hud) hud.remove(); // the menu is its own header
  renderMenu(document.body);
  setReady();
} else if (opParam && (!operation || operation.defId !== opParam)) {
  // A stale or foreign link — back to the menu rather than a broken battle.
  if (hud) hud.remove();
  renderMenu(document.body);
  setReady();
} else if (opParam && operation && operation.phase === "done") {
  if (hud) hud.remove();
  renderOperationEnd(document.body, operation);
  setReady();
} else if (opParam && operation && params.has("interlude")) {
  if (hud) hud.remove();
  renderInterlude(document.body, operation);
  setReady();
} else {
  bootBattle(operation);
}

// ── Battle / headless boot ───────────────────────────────────────────────────
function bootBattle(op: OperationState | null): void {
  const seed = Number(params.get("seed") ?? 1);
  const view = createView(container!);

  let state: GameState;
  if (params.has("deploydemo")) {
    // Verification route: an operation battle held at the deployment line.
    const demo = createOperation("op01", 7);
    for (const t of ["recon", "artillery", "supply", "engineer", "mortar_team"]) buySupport(demo, t);
    finishInterlude(demo);
    state = prepareBattle(demo);
  } else if (op) {
    state = prepareBattle(op); // the operation's carry-over does the casting
  } else {
    const mapParam = params.get("map");
    const map =
      mapParam === "breakthrough"
        ? MAP01_BREAKTHROUGH
        : mapParam === "steppe"
          ? MAP02
          : mapParam === "gap"
            ? MAP03
            : mapParam === "watchline"
              ? MAP04
              : mapParam === "causeway"
                ? MAP05
                : mapParam === "rearguard"
                  ? MAP06
                  : mapParam === "random"
                    ? randomSkirmishMap(seed, (params.get("force") as ForcePreset) ?? "standard")
                    : MAP01;
    state = createGame(map, seed);
  }

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
    // ?stage stages a move so the facing picker shows; ?fxdemo drops sample
    // battlefield effects — all for the screenshot harness.
    if (params.has("fxdemo")) {
      const c = state.map.cells[Math.floor(state.map.cells.length / 2)].hex;
      addEffect(state, "smoke", c);
      addEffect(state, "smoke", { q: c.q, r: c.r + 1 });
      addEffect(state, "fortification", { q: c.q - 2, r: c.r });
    }
    const selectId = params.has("select") ? Number(params.get("select")) : undefined;
    startInteractive(view, state, { selectId, stage: params.has("stage"), operation: op ?? undefined });
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
    if (++frames === 3) setReady();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
