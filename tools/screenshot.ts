// Self-verification harness: build is assumed done, this serves the production
// build with `vite preview`, drives a headless Chromium (WebGL via SwiftShader),
// waits for the game to render, and captures a PNG. Lets Claude *see* its output.
//
// Browser sourcing is resilient to restrictive network policies: it prefers a
// standard Playwright/system Chromium, but falls back to @sparticuz/chromium —
// a Chromium build delivered through the npm registry, so it needs no access to
// the Playwright CDN (which some network allowlists block).
//
// Usage: npm run screenshot                       → tools/shots/latest.png
//        tsx tools/screenshot.ts NAME=QUERY ...    → one PNG per capture spec,
//          e.g.  tsx tools/screenshot.ts "swarm=?seed=7&warp=12&pilot=circle"
//          writes tools/shots/swarm.png at that deterministic sim state.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, waitForServer } from "./browser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4173;
const URL = `http://localhost:${PORT}/`;

interface Capture {
  name: string;
  query: string;
}

/** Parse "name=query" argv specs; default to a single unparameterized shot. */
function parseCaptures(argv: string[]): Capture[] {
  if (argv.length === 0) return [{ name: "latest", query: "" }];
  return argv.map((spec) => {
    const eq = spec.indexOf("=");
    const name = eq >= 0 ? spec.slice(0, eq) : spec;
    const query = eq >= 0 ? spec.slice(eq + 1) : "";
    return { name, query };
  });
}

async function main(): Promise<number> {
  const outDir = path.join(root, "tools", "shots");
  mkdirSync(outDir, { recursive: true });
  const captures = parseCaptures(process.argv.slice(2));

  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: "ignore",
  });

  const errors: string[] = [];
  try {
    await waitForServer(URL);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));

    for (const cap of captures) {
      const outFile = path.join(outDir, `${cap.name}.png`);
      await page.goto(`${URL}${cap.query}`, { waitUntil: "load" });
      await page
        .waitForFunction(() => (window as { __vantageReady?: boolean }).__vantageReady === true, {
          timeout: 20000,
        })
        .catch(() => errors.push(`timeout: __vantageReady never set (${cap.name})`));
      await page.waitForTimeout(500); // let a few more frames settle
      await page.screenshot({ path: outFile });
      console.log(`screenshot -> ${outFile}  (query: ${cap.query || "none"})`);
    }
    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }

  if (errors.length) {
    console.error("PAGE PROBLEMS:\n  " + errors.join("\n  "));
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code));
