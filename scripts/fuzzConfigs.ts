/**
 * Random-configuration robustness sweep (see shared/ess/fuzz.ts).
 *
 *   npx vite-node scripts/fuzzConfigs.ts -- [count=60] [firstSeed=1]
 */
import { randomConfig, runConfig } from "../shared/ess/fuzz";

const args = process.argv.slice(2).filter((a) => a !== "--");
const count = Number(args[0] ?? 60);
const first = Number(args[1] ?? 1);
let failed = 0;
let maxCpu = 0;
for (let seed = first; seed < first + count; seed++) {
  const r = runConfig(seed);
  maxCpu = Math.max(maxCpu, r.cpu);
  if (!r.ok) {
    failed++;
    console.log(`FAIL seed ${seed}: ${r.summary}\n  ${r.problems.join("\n  ")}\n  config ${JSON.stringify(randomConfig(seed))}`);
  } else console.log(`ok   seed ${seed}: ${r.summary} | idle ${r.idleRpm.toFixed(0)} | wot ${r.wotRpm.toFixed(0)} | cpu ${r.cpu.toFixed(2)}`);
}
console.log(`\n${count - failed}/${count} passed; max CPU real-time factor ${maxCpu.toFixed(2)}`);
