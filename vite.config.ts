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
  },
});
