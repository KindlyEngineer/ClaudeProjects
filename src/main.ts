import { createView } from "./render/scene";
import { buildLevelMeshes } from "./render/levelMesh";
import { BillboardLayer } from "./render/billboards";
import { bladeTexture, discTexture, gemTexture } from "./render/textures";
import { PlayerView } from "./game/player";
import { Input } from "./game/input";
import { parsePilot, pilotInput, type Pilot } from "./game/autopilot";
import { Hud } from "./ui/hud";
import { DraftView } from "./ui/draft";
import { startLoop } from "./core/loop";
import { lerp } from "./core/math";
import { Sim, type InputState } from "./sim/sim";
import { KIND_ENEMY, KIND_GEM, KIND_ORBITER, KIND_PROJECTILE, VARIANT_BOSS } from "./sim/world";
import { W_KNOCKER, W_LANCE, W_LOB } from "./sim/weapons";
import { defaultRunConfig, type RunConfig } from "./config/runConfig";
import { FIXED_DT, MAX_ENTITIES } from "./config/balance";

// Per-weapon projectile look: tint + size multiplier (read in syncBillboards).
const PROJECTILE_TINT: Record<number, number> = {
  [W_LANCE]: 0xffe66b,
  [W_LOB]: 0xff9a3c,
  [W_KNOCKER]: 0xff5ad0,
};
const PROJECTILE_SCALE: Record<number, number> = {
  [W_LANCE]: 0.8,
  [W_LOB]: 1.9,
  [W_KNOCKER]: 1.5,
};
const BOSS_TINT = 0xb070ff;
const BOSS_SCALE = 2.4;

// Tile arenas. A run is parameterized by a RunConfig (seed + theme + character)
// and started via startRun() — the seam the future main-menu flow
// (theme → character → gameplay) will drive. The render reads the same tile
// grid the sim collides against, so geometry is consistent everywhere.

export interface RunHandle {
  stop: () => void;
}

export function startRun(
  config: RunConfig,
  opts: { warp: number; pilot: Pilot; manualDraft?: boolean },
): RunHandle {
  const container = document.getElementById("app");
  if (!container) throw new Error("#app container not found");
  const hudEl = document.getElementById("hud");
  if (!hudEl) throw new Error("#hud element not found");

  const view = createView(container, config.theme);
  const sim = new Sim(config);
  // A pilot has no human to pick cards, so it auto-resolves drafts; live
  // keyboard play (pilot "none") flips this off so the modal appears.
  // `manualDraft` forces the modal on even under a pilot (for captures/debug).
  sim.autoDraft = opts.manualDraft ? false : opts.pilot !== "none";

  view.scene.add(buildLevelMeshes(sim.level, config.theme));

  const player = new PlayerView();
  view.scene.add(player.mesh);

  const enemies = new BillboardLayer(discTexture("#ff8a5c", "#b3263a"), 1.5, 0xffffff, MAX_ENTITIES);
  const projectiles = new BillboardLayer(discTexture("#ffffff", "#7fd7ff"), 0.55, 0xffffff, 512);
  const orbiters = new BillboardLayer(bladeTexture("#39d6ff"), 1.1, 0xffffff, 64);
  const gems = new BillboardLayer(gemTexture("#54f0c0"), 0.6, 0xffffff, 1024);
  view.scene.add(enemies.mesh, projectiles.mesh, orbiters.mesh, gems.mesh);

  const hud = new Hud(hudEl);
  const draftEl = document.getElementById("draft");
  if (!draftEl) throw new Error("#draft element not found");
  const draft = new DraftView(draftEl);
  const keyboard = new Input();
  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);

  const currentInput = (): InputState =>
    opts.pilot === "none" ? keyboard.moveVector() : pilotInput(opts.pilot, sim.time);

  function syncBillboards(): void {
    const q = view.camera.quaternion;
    enemies.begin(q);
    projectiles.begin(q);
    orbiters.begin(q);
    gems.begin(q);
    const w = sim.world;
    for (let i = 0; i < w.cap; i++) {
      if (w.alive[i] !== 1) continue;
      const x = w.px[i];
      const z = w.pz[i];
      const k = w.kind[i];
      if (k === KIND_ENEMY) {
        if (w.variant[i] === VARIANT_BOSS) enemies.push(x, 1.4, z, BOSS_SCALE, BOSS_TINT);
        else enemies.push(x, 0.75, z);
      } else if (k === KIND_PROJECTILE) {
        const wk = w.wkind[i];
        projectiles.push(x, 0.9, z, PROJECTILE_SCALE[wk] ?? 1, PROJECTILE_TINT[wk]);
      } else if (k === KIND_ORBITER) {
        orbiters.push(x, 0.9, z);
      } else if (k === KIND_GEM) {
        gems.push(x, 0.35, z);
      }
    }
    enemies.end();
    projectiles.end();
    orbiters.end();
    gems.end();
  }

  function draw(alpha: number): void {
    const px = lerp(sim.playerPrevX, sim.playerX, alpha);
    const pz = lerp(sim.playerPrevZ, sim.playerZ, alpha);
    player.sync(px, pz, 0);
    view.followCamera(px, 0, pz);
    syncBillboards();
    hud.update(sim);
    // Level-up draft: pause and present the cards (auto-resolved runs never pend).
    const options = sim.currentDraft();
    if (options) draft.sync(options, (i) => sim.chooseUpgrade(i));
    else draft.hide();
    view.render();
  }

  // Deterministic fast-forward for screenshots: advance the sim with no render.
  // (Piloted warps auto-resolve drafts and build a loadout; a no-pilot warp
  // leaves the draft pending, so a capture lands on the level-up modal.)
  if (opts.warp > 0) {
    const steps = Math.round(opts.warp / FIXED_DT);
    for (let s = 0; s < steps && !sim.draftPending(); s++) sim.update(FIXED_DT, currentInput());
  }

  let frames = 0;
  const stopLoop = startLoop(
    {
      // Freeze the sim while a level-up draft is awaiting the player's pick.
      update: (dt) => {
        if (!sim.draftPending()) sim.update(dt, currentInput());
      },
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
  manualDraft: params.get("manualdraft") === "1",
});
