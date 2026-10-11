import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "server-only": resolve("scripts/server-only-test.ts") } },
  test: {
    include: ["packages/**/*.integration.test.ts", "apps/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/src/generated/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
