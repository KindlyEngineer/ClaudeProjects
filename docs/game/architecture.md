# VANTAGE — Technical Architecture

Companion to `design.md`. This is the engineering plan: stack, data layout,
systems, the render approach, how Claude self-verifies, and the build milestones.

Status: **Architecture draft** (pre-implementation). Last updated: 2026-06-03.

---

## 1. Stack decision & rationale

**TypeScript + Three.js (WebGL) + Vite**, built from scratch (no game engine).

Chosen specifically to maximize what can be built **autonomously through a
terminal**, with a closed self-verification loop:

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Static types catch a class of bugs without running; great refactor ergonomics for a growing sim. |
| Render | **Three.js / WebGL** | Mature, code-only 3D. `InstancedMesh` renders thousands of billboards cheaply. Gives true 3D depth → the "non-pancake" 2.5D look. |
| Build/dev | **Vite** | Instant HMR, trivial static build (`dist/`) the user can open anywhere. |
| Runtime | **Browser** | Zero-install for the player; instantly shareable; and lets Claude screenshot via headless Chromium to verify visually. |
| QA harness | **Playwright (Chromium)** | Claude runs the game headless, screenshots, and inspects state — closing the feedback loop without a human. |
| Tests | **Vitest** | Fast unit tests for pure sim logic (math, terrain, collision, leveling). |

**Why not Godot/Unity/Unreal:** they assume a human in a GUI scene editor. Code-only
keeps the entire game legible and editable from files.

**Why not Bevy/Rust (more performant):** it would cost the screenshot-driven
self-verification loop, which matters more here than raw entity count. WebGL
instancing comfortably handles bullet-heaven scales (1k–5k entities) at 60fps.

---

## 2. High-level shape

```
src/
  main.ts            # bootstrap: canvas, renderer, game loop
  core/
    loop.ts          # fixed-timestep update + interpolated render
    rng.ts           # seeded PRNG (deterministic runs/tests)
    time.ts          # clock, dt, run timer
  ecs/
    world.ts         # entity allocation, component stores (SoA)
    components.ts    # typed-array component definitions
    systems/         # one file per system (see §4)
  terrain/
    heightmap.ts     # generation + sampling (height, slope, normal)
    bands.ts         # coarse elevation bands for gameplay rules
  render/
    scene.ts         # three.js scene, camera, lights, fog
    billboards.ts    # InstancedMesh sprite layer (enemies/pickups)
    terrainMesh.ts   # heightmap -> geometry
    debugDraw.ts     # gizmos for dev/verification
  game/
    spawnDirector.ts # wave/difficulty curve
    weapons.ts       # weapon definitions + firing
    upgrades.ts      # draft pool + apply
    player.ts        # input -> intent
  ui/
    hud.ts           # health, xp, timer, level-up draft overlay
  config/
    balance.ts       # all tunable numbers in one place
test/                # vitest unit tests (pure logic)
tools/
  screenshot.ts      # Playwright capture for self-verification
```

---

## 3. Data layout: a tiny ECS (Structure-of-Arrays)

Bullet-heaven = many homogeneous entities updated every frame. We use a
**data-oriented ECS** with components stored as parallel typed arrays, not objects:

```ts
// Conceptual
const MAX = 8192;
const posX = new Float32Array(MAX);
const posY = new Float32Array(MAX);   // y = world height (sampled from terrain)
const posZ = new Float32Array(MAX);
const velX = new Float32Array(MAX);
const velZ = new Float32Array(MAX);
const hp   = new Float32Array(MAX);
const kind = new Uint8Array(MAX);     // enemy archetype / projectile / pickup
const flags= new Uint8Array(MAX);     // alive, flyer, elite, ...
```

- **Why SoA:** cache-friendly, GC-free hot loop, easy to vectorize mentally, and
  trivially fast to iterate over for 1000s of entities.
- **Entity = index** into these arrays + a free-list allocator for spawn/despawn.
- Rendering reads positions and writes them into the `InstancedMesh` matrix buffer
  once per frame.

Ground plane convention: **XZ is the play plane, Y is up/height.** Most sim math is
2D (XZ); terrain provides the Y and the height-delta rules.

---

## 4. Systems (update order)

Fixed timestep (e.g. 60 Hz sim), render interpolates between sim states.

1. **input** → player intent (move vector, dash).
2. **playerMove** → apply terrain-aware speed (slope up/down), resolve walls.
3. **spawnDirector** → emit enemies per difficulty curve & terrain rules.
4. **enemyAI** → steer toward player (flow toward, avoid walls/pits; flyers ignore).
5. **physics/integrate** → integrate velocities; sample terrain height for Y;
   apply knockback; handle ledge falls & pit deaths.
6. **collisionGrid** → spatial hash on XZ; broadphase enemy↔player, projectile↔enemy.
7. **weapons** → tick cadences, spawn projectiles/auras, apply high-ground &
   line-of-sight modifiers.
8. **damage/death** → resolve hits, hit-flash, drop XP gems on death.
9. **pickups** → XP gems roll downhill + magnet toward player; apply on contact.
10. **leveling** → XP thresholds → pause for upgrade draft.
11. **render-sync** → push transforms to InstancedMesh; update HUD.

Each system is a pure-ish function `(world, dt) => void` for testability.

---

## 5. Terrain model

- **Generation:** seeded heightmap (value/Perlin-ish noise + a few hand-tuned
  "feature" stamps: ridges, plateaus, ramps, pits). Deterministic from run seed.
- **Sampling API:** `heightAt(x,z)`, `slopeAt(x,z)`, `normalAt(x,z)`,
  `bandAt(x,z)` (coarse elevation tier for gameplay rules & readability).
- **Gameplay derivations:**
  - high-ground multiplier = f(attacker.band − target.band)
  - line-of-sight = raymarch the heightmap between two points
  - pit = band below threshold → lethal volume
- **Rendering:** heightmap → `PlaneGeometry` displaced per-vertex, vertex-colored
  by elevation band; soft fog for depth cueing.
- **Pathing (MVP):** steer-toward-player + local obstacle avoidance (sample
  slope/wall ahead and steer around). Upgrade to flow-field later if needed for
  large hordes around complex terrain.

---

## 6. Rendering approach (the 2.5D look)

- **Camera:** perspective, fixed tilt (~35–50° from horizontal), follows player,
  slight look-ahead. This is the Megabonk/ARPG angle that yields depth + parallax.
- **Enemies/pickups:** **billboarded sprite quads** in one (or few) `InstancedMesh`
  per texture atlas — always face the camera, but occupy true 3D positions, so they
  rise/fall with terrain and sort by depth. This is the trick that gives a "3D"
  feel with 2D art and no modeling pipeline.
- **Terrain/props:** real low-poly 3D meshes.
- **Depth & readability:** fog, elevation tinting, ground-contact shadows
  (cheap blob shadows) so floating billboards read as grounded.
- **Scale target:** 1k enemies MVP, design headroom to 3–5k via instancing +
  frustum/distance culling.

---

## 7. Self-verification harness (how Claude checks its own work)

This is core to the "how much can Claude do solo" goal.

- `tools/screenshot.ts`: Playwright launches headless Chromium, loads the dev/preview
  build, optionally drives input + advances the sim a fixed number of seeded ticks,
  then captures a PNG. Claude reads the PNG to verify the scene visually.
- **Determinism:** seeded RNG + fixed-timestep means a screenshot at "tick N, seed S"
  is reproducible — good for visual regression and for me to reason about state.
- **Debug overlay / state dump:** a dev flag renders gizmos (entity counts, bands,
  collision grid) and can dump JSON game state for assertion in tests.
- **Vitest** covers pure logic (terrain sampling, high-ground math, collision,
  leveling curves, RNG) with no browser.
- Loop per change: `typecheck → vitest → build → screenshot → inspect`.

> **Browser sourcing:** the harness prefers a standard Playwright/system
> Chromium, but falls back to `@sparticuz/chromium` — a Chromium build delivered
> through the **npm registry** — so the screenshot step works even under a
> restrictive network *allowlist* that blocks the Playwright CDN
> (`cdn.playwright.dev` → `403 Host not in allowlist`). WebGL renders via
> SwiftShader (`setGraphicsMode`/`--use-angle=swiftshader`). Regardless, we keep
> as much logic as possible (movement, camera math, terrain sampling, collision,
> leveling) in Vitest, since Three.js geometry/mesh construction needs **no** GPU
> and runs headlessly anywhere.

---

## 8. Performance plan
- GC-free hot path (typed arrays, object pools, no per-frame allocations).
- Spatial hash grid for broadphase (rebuilt each tick; cheap for uniform density).
- One `InstancedMesh` per sprite atlas; update matrices in a flat buffer.
- Distance/frustum culling; cap simulated-but-offscreen detail.
- Fixed-timestep sim decoupled from render; clamp catch-up to avoid spirals.
- Budget: 60fps with ~1k active enemies on a mid laptop for MVP.

---

## 9. Milestones

> Each milestone ends in a **playable, screenshot-verified** state and a commit on
> `claude/eager-thompson-TIBmS`.

- **M0 — Scaffold** ✅ *(done)*
  Vite + TS + Three.js project, fixed-timestep loop w/ interpolation, tilted
  follow-camera, lit ground + reference grid, WASD-controllable capsule,
  Playwright screenshot tool, Vitest wired. Verified headlessly: typecheck clean,
  13 unit tests pass (RNG determinism, vector math, player integration, render
  interpolation, follow-cam placement), production build succeeds, and the
  in-session **screenshot renders** (capsule + cast shadow under the tilt cam)
  via the npm-delivered Chromium fallback — no network-policy change needed.

- **M1 — Horde slice**
  SoA ECS, one billboarded chaser enemy type, spawn director, spatial-hash
  collision, one auto-weapon, enemies die + drop XP, basic HUD. Verify: screenshot
  shows a swarm converging + projectiles.

- **M2 — Terrain becomes real**
  Heightmap generation + mesh, terrain-aware movement, high-ground damage bonus,
  pits = death, knockback-off-ledges, XP gems roll downhill. Verify: high-ground
  rule measurably changes damage; enemies path around walls.

- **M3 — The build loop**
  Level-up upgrade draft, 4–6 weapons (incl. downhill/lobber/knocker archetypes),
  weapon leveling, difficulty curve + first boss. Verify: a full ~10-min run is
  survivable and the draft meaningfully changes the run.

- **M4 — Feel & content pass**
  Juice (hit-stop, shake, number pops, death fx), more enemy types incl. flyers,
  seeded-procedural arenas, audio hooks, title/death/meta screens.

- **M5 — Ship a build**
  Static `dist/` build, simple landing page, optional GitHub Pages deploy.

---

## 10. Risks & mitigations
- **Headless screenshots may differ from real GPUs** (WebGL in headless Chromium).
  → Use SwiftShader/ANGLE fallback; treat screenshots as smoke-tests, not pixel-
  perfect truth; keep logic in Vitest where possible.
- **Perf cliff at high entity counts.** → Instancing + spatial hash from day one;
  profile at M1, don't let it rot.
- **Scope creep (it's a genre with infinite features).** → Milestone gates + the
  "does it make 3D positioning more interesting?" test from the design doc.
- **Art bottleneck.** → Placeholder primitives/flat billboards through M3; art is
  explicitly deferred.
