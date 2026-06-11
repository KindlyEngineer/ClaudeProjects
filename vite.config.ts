import { defineConfig } from "vitest/config";

// Vite + Vitest config. The `test` block configures unit tests (pure sim logic),
// which run in Node with no browser.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Several proofs run full AI-vs-AI matches (coreproof, selfplay, opgen) —
    // they sit near vitest's 5s default on slow CI runners (deploy run #9
    // flaked exactly there). Real hangs still die, just with a wider budget.
    testTimeout: 120_000,
  },
});
