import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname);
const base = process.env.GITHUB_PAGES === "true" ? "/EngineSS/" : "/";

export default defineConfig({
  root: path.resolve(root, "client"),
  base,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "client/src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  build: {
    outDir: path.resolve(root, "dist"),
    emptyOutDir: true,
  },
});
