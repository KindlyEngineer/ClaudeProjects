// End-to-end test of the BattleTech-style press-drag-release command gesture —
// the one path unit tests can't cover (real mouse events through the raycaster
// into the action API). Serves the production build, drives a headless browser:
//
//   1. MOVE: press a reachable hex, drag toward a neighbour to aim the facing,
//      release — the unit must end on that hex WITH the aimed facing.
//   2. TURN-IN-PLACE: press the unit's own hex, drag, release — same hex, new
//      facing, move activation spent.
//
// The page exposes window.__vantage ({ state, select, moves, screenOf }) for
// introspection/projection. Usage: npm run uitest   (vite build runs first).

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { launchBrowser, waitForServer } from "./browser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4174;
const URL = `http://localhost:${PORT}/`;

interface XY {
  x: number;
  y: number;
}

const failures: string[] = [];
function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

/** Drag from `from` to `to` with intermediate steps so mousemove handlers run,
 *  then wait out the event-playback animation (input is parked while it runs). */
async function drag(page: Page, from: XY, to: XY): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
  await page.waitForFunction(
    () => !(window as unknown as { __vantage: { busy: () => boolean } }).__vantage.busy(),
    { timeout: 15000 },
  );
  await page.waitForTimeout(80); // let the post-playback refresh settle
}

async function main(): Promise<number> {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: "ignore",
  });
  try {
    await waitForServer(URL);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // Unit 2 = the player's recon (ready in the opening recon phase).
    await page.goto(`${URL}?select=2`, { waitUntil: "load" });
    await page.waitForFunction(() => (window as { __vantageReady?: boolean }).__vantageReady === true, { timeout: 20000 });

    // ── 1. Move with drag-aimed facing ─────────────────────────────────────────
    const before = await page.evaluate(() => {
      const v = (window as unknown as { __vantage: { state: { units: Array<{ id: number; hex: { q: number; r: number }; facing: number }> } } }).__vantage;
      const u = v.state.units.find((x) => x.id === 2)!;
      return { hex: u.hex, facing: u.facing };
    });
    const keys: string[] = await page.evaluate(() => (window as unknown as { __vantage: { moves: () => string[] } }).__vantage.moves());
    check(keys.length > 0, `recon has reachable hexes (${keys.length})`);

    // Aim the move at the farthest-projected reachable hex for a clean drag.
    const dest = keys[keys.length - 1];
    const [dq, dr] = dest.split(",").map(Number);
    const destPx: XY = await page.evaluate((k) => (window as unknown as { __vantage: { screenOf: (key: string) => XY } }).__vantage.screenOf(k), dest);
    // Aim the facing at direction 2 (neighbour q+0, r-1) by dragging toward it.
    const aimKey = `${dq + 0},${dr - 1}`;
    const aimPx: XY = await page.evaluate((k) => (window as unknown as { __vantage: { screenOf: (key: string) => XY } }).__vantage.screenOf(k), aimKey);
    await drag(page, destPx, aimPx);

    const afterMove = await page.evaluate(() => {
      const v = (window as unknown as { __vantage: { state: { units: Array<{ id: number; hex: { q: number; r: number }; facing: number; movedThisTurn: boolean }> } } }).__vantage;
      const u = v.state.units.find((x) => x.id === 2)!;
      return { hex: u.hex, facing: u.facing, moved: u.movedThisTurn };
    });
    check(afterMove.hex.q === dq && afterMove.hex.r === dr, `unit moved to pressed hex (${dest})`);
    check(afterMove.facing === 2, `facing aimed by drag = 2 (got ${afterMove.facing})`);
    check(afterMove.moved, "move activation spent");
    check(!(before.hex.q === afterMove.hex.q && before.hex.r === afterMove.hex.r), "position actually changed");

    // ── 2. Turn-in-place on the infantry (also a recon-phase unit) ────────────
    await page.evaluate(() => {
      const v = (window as unknown as { __vantage: { select: (id: number) => void; state: { units: Array<{ id: number; typeId: string; controller: string }> } } }).__vantage;
      const inf = v.state.units.find((x) => x.typeId === "infantry" && x.controller === "player")!;
      v.select(inf.id);
    });
    await page.waitForTimeout(80);
    const inf = await page.evaluate(() => {
      const v = (window as unknown as { __vantage: { state: { units: Array<{ id: number; typeId: string; controller: string; hex: { q: number; r: number }; facing: number }> } } }).__vantage;
      const u = v.state.units.find((x) => x.typeId === "infantry" && x.controller === "player")!;
      return { id: u.id, hex: u.hex, facing: u.facing };
    });
    const ownKey = `${inf.hex.q},${inf.hex.r}`;
    const ownPx: XY = await page.evaluate((k) => (window as unknown as { __vantage: { screenOf: (key: string) => XY } }).__vantage.screenOf(k), ownKey);
    // Drag toward direction 3's neighbour (q-1, r+0) → an about-face west.
    const westKey = `${inf.hex.q - 1},${inf.hex.r}`;
    const westPx: XY = await page.evaluate((k) => (window as unknown as { __vantage: { screenOf: (key: string) => XY } }).__vantage.screenOf(k), westKey);
    await drag(page, ownPx, westPx);

    const afterTurn = await page.evaluate((id) => {
      const v = (window as unknown as { __vantage: { state: { units: Array<{ id: number; hex: { q: number; r: number }; facing: number; movedThisTurn: boolean }> } } }).__vantage;
      const u = v.state.units.find((x) => x.id === id)!;
      return { hex: u.hex, facing: u.facing, moved: u.movedThisTurn };
    }, inf.id);
    check(afterTurn.hex.q === inf.hex.q && afterTurn.hex.r === inf.hex.r, "turn-in-place kept the hex");
    check(afterTurn.facing === 3, `turn-in-place aimed facing = 3 (got ${afterTurn.facing})`);
    check(afterTurn.moved, "turning spent the move activation");

    // ── 3. Fire: plant an enemy next to the recon and click it ────────────────
    // (Exercises the attack click + the tracer/impact playback path end-to-end.)
    const enemyHexKey: string = await page.evaluate(() => {
      const v = (window as unknown as {
        __vantage: { select: (id: number) => void; state: { units: Array<{ id: number; side: string; typeId: string; hex: { q: number; r: number } }> } };
      }).__vantage;
      const recon = v.state.units.find((x) => x.id === 2)!;
      const enemy = v.state.units.find((x) => x.side === "red" && x.typeId === "infantry")!;
      enemy.hex = { q: recon.hex.q + 1, r: recon.hex.r }; // adjacent, in the MG's range
      v.select(2); // reselect so the red target overlay computes
      return `${enemy.hex.q},${enemy.hex.r}`;
    });
    await page.waitForTimeout(80);
    const enemyPx: XY = await page.evaluate((k) => (window as unknown as { __vantage: { screenOf: (key: string) => XY } }).__vantage.screenOf(k), enemyHexKey);
    await page.mouse.click(enemyPx.x, enemyPx.y);
    await page.waitForFunction(() => !(window as unknown as { __vantage: { busy: () => boolean } }).__vantage.busy(), { timeout: 15000 });
    const fired = await page.evaluate(() => {
      const v = (window as unknown as { __vantage: { state: { events: Array<{ kind: string; id?: number }>; units: Array<{ id: number; actedThisTurn: boolean }> } } }).__vantage;
      const ev = [...v.state.events].reverse().find((e) => e.kind === "fire");
      return { hasFire: !!ev, byRecon: ev?.id === 2, acted: v.state.units.find((u) => u.id === 2)!.actedThisTurn };
    });
    check(fired.hasFire && fired.byRecon, "clicking the enemy fired the recon's weapon");
    check(fired.acted, "firing spent the main action");

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ""}`);
    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }
  if (failures.length) {
    console.error(`\nUI GESTURE TEST FAILED (${failures.length}):\n  ${failures.join("\n  ")}`);
    return 1;
  }
  console.log("\nUI gesture test passed.");
  return 0;
}

main().then((code) => process.exit(code));
