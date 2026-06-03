import { createView } from "./render/scene";
import { BillboardLayer } from "./render/billboards";
import { discTexture, gemTexture } from "./render/textures";
import { PlayerView } from "./game/player";
import { Input } from "./game/input";
import { parsePilot, pilotInput } from "./game/autopilot";
import { Hud } from "./ui/hud";
import { startLoop } from "./core/loop";
import { Sim, type InputState } from "./sim/sim";
import { KIND_ENEMY, KIND_GEM, KIND_PROJECTILE } from "./sim/world";
import { FIXED_DT, MAX_ENTITIES } from "./config/balance";

// M1 bootstrap: the horde slice. Sim (pure typed-array state) drives the render
// — a billboard layer per entity kind, the player capsule, and the HUD.
//
// URL params make captures/debugging deterministic:
//   ?seed=N   seed the run        ?pilot=circle  auto-kite the player
//   ?warp=S   fast-forward S seconds of sim before the first render

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed") ?? 1);
const pilot = parsePilot(params.get("pilot"));
const warp = Number(params.get("warp") ?? 0);

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");
const hudEl = document.getElementById("hud");
if (!hudEl) throw new Error("#hud element not found");

const view = createView(container);
const sim = new Sim(seed);

const player = new PlayerView();
view.scene.add(player.mesh);

// Sprite billboard layers (sized so enemies read big, projectiles/gems small).
const enemies = new BillboardLayer(discTexture("#ff8a5c", "#b3263a"), 1.5, 0xffffff, MAX_ENTITIES);
const projectiles = new BillboardLayer(discTexture("#ffffff", "#7fd7ff"), 0.55, 0xffffff, 512);
const gems = new BillboardLayer(gemTexture("#54f0c0"), 0.6, 0xffffff, 1024);
view.scene.add(enemies.mesh, projectiles.mesh, gems.mesh);

const hud = new Hud(hudEl);
const keyboard = new Input();
window.addEventListener("resize", view.resize);

function currentInput(): InputState {
  return pilot === "none" ? keyboard.moveVector() : pilotInput(pilot, sim.time);
}

function syncBillboards(): void {
  const q = view.camera.quaternion;
  enemies.begin(q);
  projectiles.begin(q);
  gems.begin(q);
  const w = sim.world;
  for (let i = 0; i < w.cap; i++) {
    if (w.alive[i] !== 1) continue;
    const k = w.kind[i];
    if (k === KIND_ENEMY) enemies.push(w.px[i], 0.75, w.pz[i]);
    else if (k === KIND_PROJECTILE) projectiles.push(w.px[i], 0.8, w.pz[i]);
    else if (k === KIND_GEM) gems.push(w.px[i], 0.35, w.pz[i]);
  }
  enemies.end();
  projectiles.end();
  gems.end();
}

function draw(alpha: number): void {
  player.sync(sim.playerPrevX, sim.playerPrevZ, sim.playerX, sim.playerZ, alpha);
  view.followCamera(sim.playerX, sim.playerZ);
  syncBillboards();
  hud.update(sim);
  view.render();
}

// Deterministic fast-forward for screenshots: advance the sim with no rendering.
if (warp > 0) {
  const steps = Math.round(warp / FIXED_DT);
  for (let s = 0; s < steps; s++) sim.update(FIXED_DT, currentInput());
}

let frames = 0;
startLoop(
  {
    update: (dt) => sim.update(dt, currentInput()),
    render: (alpha) => {
      draw(alpha);
      if (++frames === 3) {
        (window as unknown as { __vantageReady?: boolean }).__vantageReady = true;
      }
    },
  },
  FIXED_DT,
);
