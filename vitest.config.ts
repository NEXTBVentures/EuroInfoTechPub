import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "server-only": resolve("scripts/server-only-test.ts") } },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/src/generated/**", "**/*.integration.test.ts"],
    environment: "node",
    globals: true,
  },
});
