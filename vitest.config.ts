import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // The physics tests simulate seconds of engine time each. The largest untimed one (the
    // 24-cylinder Vulture on the dyno) takes 2.8 s on a development machine; a CI runner 1.7 times
    // slower took it past vitest's 5 s default and failed the run.
    testTimeout: 30_000,
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "shared/**/*.test.ts", "legacy/**/*.test.ts", "client/src/**/*.test.ts"],
  },
});
