// Shared headless-browser plumbing for the verification harnesses
// (tools/screenshot.ts, tools/uitest.ts): WebGL-capable Chromium sourcing that
// works under restrictive network policies, plus a preview-server readiness wait.

import type { Browser } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

// WebGL-enabling flags for headless software rendering.
export const GL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

/** Launch Chromium, preferring a normal Playwright browser, else the npm one
 *  (@sparticuz/chromium — delivered via the npm registry, so it needs no access
 *  to the Playwright CDN, which some network allowlists block). */
export async function launchBrowser(): Promise<Browser> {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ args: GL_ARGS });
    console.log("browser: playwright chromium");
    return b;
  } catch (err) {
    console.log(`browser: falling back to @sparticuz/chromium (${(err as Error).message.split("\n")[0]})`);
    const sparticuz = (await import("@sparticuz/chromium")).default;
    sparticuz.setGraphicsMode = true; // enable WebGL via swiftshader
    const { chromium } = await import("playwright-core");
    const executablePath = await sparticuz.executablePath();
    return chromium.launch({ executablePath, args: [...sparticuz.args, ...GL_ARGS] });
  }
}

export async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(250);
  }
  throw new Error(`preview server did not become ready at ${url}`);
}
