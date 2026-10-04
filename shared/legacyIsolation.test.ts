import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The legacy (v0–v15) sound model lives in legacy/ for A/B renders and regression tests.
// It must never reach the shipped app (client/), the shared runtime (shared/) or the server.
const root = path.resolve(import.meta.dirname, "..");
const shippedDirs = ["client/src", "shared", "server"];
const self = path.resolve(import.meta.filename);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && full !== self) out.push(full);
  }
  return out;
}

describe("legacy isolation", () => {
  const files = shippedDirs.flatMap((d) => sourceFiles(path.join(root, d)));

  it("finds the shipped sources", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no shipped source imports from legacy/", () => {
    const legacyDir = path.join(root, "legacy") + path.sep;
    const offenders: string[] = [];
    const specifier = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(specifier)) {
        const spec = match[1];
        if (!spec.startsWith(".")) continue;
        if ((path.resolve(path.dirname(file), spec) + path.sep).startsWith(legacyDir)) {
          offenders.push(`${path.relative(root, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no shipped source registers or creates the legacy worklet", () => {
    const offenders = files.filter((file) => readFileSync(file, "utf8").includes("combustion-processor"));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
