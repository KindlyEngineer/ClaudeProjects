import { createView } from "./render/scene";
import { buildTerrainMesh } from "./render/terrainMesh";
import { BillboardLayer } from "./render/billboards";
import { discTexture, gemTexture } from "./render/textures";
import { PlayerView } from "./game/player";
import { Input } from "./game/input";
import { parsePilot, pilotInput, type Pilot } from "./game/autopilot";
import { Hud } from "./ui/hud";
import { startLoop } from "./core/loop";
import { lerp } from "./core/math";
import { Sim, type InputState } from "./sim/sim";
import { KIND_ENEMY, KIND_GEM, KIND_PROJECTILE } from "./sim/world";
import { defaultRunConfig, type RunConfig } from "./config/runConfig";
import { ARENA_RADIUS, FIXED_DT, MAX_ENTITIES } from "./config/balance";

// M2: terrain becomes real. A run is now parameterized by a RunConfig (seed +
// theme + character) and started via startRun() — the seam the future
// main-menu flow (theme → character → gameplay) will drive. The render reads
// the same heightmap the sim does, so elevation is consistent everywhere.

export interface RunHandle {
  stop: () => void;
}

export function startRun(config: RunConfig, opts: { warp: number; pilot: Pilot }): RunHandle {
  const container = document.getElementById("app");
  if (!container) throw new Error("#app container not found");
  const hudEl = document.getElementById("hud");
  if (!hudEl) throw new Error("#hud element not found");

  const view = createView(container, config.theme);
  const sim = new Sim(config);

  view.scene.add(buildTerrainMesh(sim.terrain, config.theme, ARENA_RADIUS * 2 + 20));

  const player = new PlayerView();
  view.scene.add(player.mesh);

  const enemies = new BillboardLayer(discTexture("#ff8a5c", "#b3263a"), 1.5, 0xffffff, MAX_ENTITIES);
  const projectiles = new BillboardLayer(discTexture("#ffffff", "#7fd7ff"), 0.55, 0xffffff, 512);
  const gems = new BillboardLayer(gemTexture("#54f0c0"), 0.6, 0xffffff, 1024);
  view.scene.add(enemies.mesh, projectiles.mesh, gems.mesh);

  const hud = new Hud(hudEl);
  const keyboard = new Input();
  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);

  const currentInput = (): InputState =>
    opts.pilot === "none" ? keyboard.moveVector() : pilotInput(opts.pilot, sim.time);

  function syncBillboards(): void {
    const q = view.camera.quaternion;
    enemies.begin(q);
    projectiles.begin(q);
    gems.begin(q);
    const w = sim.world;
    const t = sim.terrain;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1) continue;
      const x = w.px[i];
      const z = w.pz[i];
      const gy = t.heightAt(x, z); // sit each sprite on the ground it's over
      const k = w.kind[i];
      if (k === KIND_ENEMY) enemies.push(x, gy + 0.75, z);
      else if (k === KIND_PROJECTILE) projectiles.push(x, gy + 0.9, z);
      else if (k === KIND_GEM) gems.push(x, gy + 0.35, z);
    }
    enemies.end();
    projectiles.end();
    gems.end();
  }

  function draw(alpha: number): void {
    const px = lerp(sim.playerPrevX, sim.playerX, alpha);
    const pz = lerp(sim.playerPrevZ, sim.playerZ, alpha);
    const gy = sim.terrain.heightAt(px, pz);
    player.sync(px, pz, gy);
    view.followCamera(px, gy, pz);
    syncBillboards();
    hud.update(sim);
    view.render();
  }

  // Deterministic fast-forward for screenshots: advance the sim with no render.
  if (opts.warp > 0) {
    const steps = Math.round(opts.warp / FIXED_DT);
    for (let s = 0; s < steps; s++) sim.update(FIXED_DT, currentInput());
  }

  let frames = 0;
  const stopLoop = startLoop(
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

  return {
    stop: () => {
      stopLoop();
      window.removeEventListener("resize", onResize);
      view.dispose();
    },
  };
}

// Boot a single run. URL params make captures/debugging deterministic:
//   ?seed=N   seed the run        ?pilot=circle  auto-kite the player
//   ?warp=S   fast-forward S seconds of sim before the first render
const params = new URLSearchParams(location.search);
startRun(defaultRunConfig(Number(params.get("seed") ?? 1)), {
  warp: Number(params.get("warp") ?? 0),
  pilot: parsePilot(params.get("pilot")),
});
