/**
 * Random-configuration robustness sweep for the v16 core (CLI: scripts/fuzzConfigs.ts).
 * Deterministic per seed: a failure is reproducible from its seed.
 *
 * Each configuration runs idle (free), full load on the dyno at 70 % of redline, closed-pedal
 * overrun and a free-rev blip. Checks: resolver/constructor exceptions, non-finite audio or state,
 * stalls at idle, runaway speed past the limiter, and CPU real-time factor.
 */
import { EngineSimulator } from "./engine";
import { resolveEngineSpec } from "./resolveSpec";
import type { EngineConfiguration } from "../engineTypes";

export interface FuzzOptions {
  /** Allow the diesel variant draw (default true). */
  diesel?: boolean;
  /** Allow the two-stroke variant draw (default true). */
  twoStroke?: boolean;
  /** Allow the rotary variant draw (default true). */
  rotary?: boolean;
}

export function randomConfig(seed: number, opts: FuzzOptions = {}): EngineConfiguration {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const layout = pick(["inline", "inline", "v", "v", "flat", "w", "radial"] as const);
  const counts: Record<string, number[]> = { inline: [1, 2, 3, 4, 5, 6, 8], v: [2, 4, 6, 8, 10, 12, 16], flat: [2, 4, 6, 8, 12], w: [8, 12, 16], radial: [3, 5, 7, 9] };
  const n = pick(counts[layout]);
  const perCyl = 0.1 + rnd() * 1.3;
  const displacement = Math.round(n * perCyl * 100) / 100;
  // Smaller cylinders rev higher (piston speed limit ~25 m/s with typical bore/stroke).
  const redline = Math.round(Math.min(16000, Math.max(3500, 9000 * Math.pow(0.5 / perCyl, 0.33) * (0.75 + 0.5 * rnd()))) / 100) * 100;
  const aspiration = pick(["na", "na", "na", "turbo", "turbo", "supercharged"] as const);
  const config: EngineConfiguration = {
    soundProfile: "v16",
    seed,
    quick: {
      layout,
      cylinderCount: n,
      displacement,
      crankshaft: pick(["cross-plane", "flat-plane", "even-fire", "odd-fire"] as const),
      aspiration,
      exhaustCharacter: pick(["stock", "sport", "race", "straight-pipe"] as const),
      idleCharacter: pick(["smooth", "lumpy", "aggressive", "lopey"] as const),
      redline,
    },
    forcedInduction:
      aspiration === "turbo"
        ? { type: "turbo", turboSize: pick(["small", "balanced", "large"] as const), maxBoost: 5 + rnd() * 25, wastegateEnabled: rnd() > 0.1, bovEnabled: rnd() > 0.3 }
        : aspiration === "supercharged"
          ? { type: "supercharged", superchargerType: pick(["roots", "twin-screw", "centrifugal"] as const), superchargerBoost: 4 + rnd() * 14 }
          : { type: "na" },
    physical: {},
  } as EngineConfiguration;
  const ph: Record<string, unknown> = {};
  if (rnd() < 0.5) ph.compressionRatio = 7 + rnd() * (aspiration === "na" ? 7 : 4);
  if (rnd() < 0.4) {
    ph.intakeDurationDeg = 190 + rnd() * 110;
    ph.exhaustDurationDeg = 190 + rnd() * 110;
  }
  if (rnd() < 0.4) ph.intakePhaserDeg = rnd() * 60;
  if (rnd() < 0.25) ph.exhaustPhaserDeg = rnd() * 45;
  if (rnd() < 0.15) ph.liftSwitchRpm = Math.round(redline * (0.5 + 0.3 * rnd()));
  if (rnd() < 0.3) ph.muffler = pick(["turbo", "chambered", "straight-through", "glasspack", "none"]);
  if (rnd() < 0.15) ph.droneTubeHz = 60 + rnd() * 200;
  if (rnd() < 0.15) {
    ph.helmholtzHz = 60 + rnd() * 200;
    ph.helmholtzVolumeL = 0.5 + rnd() * 5;
  }
  if (rnd() < 0.15) ph.exhaustValveMode = pick(["auto", "open", "closed"]);
  if (rnd() < 0.3) ph.buildTolerance = rnd();
  if (rnd() < 0.3) ph.fuelOctane = 85 + rnd() * 25;
  if (rnd() < 0.15) ph.knockControl = false;
  if (rnd() < 0.2) ph.camLobeGamma = 0.6 + rnd() * 2;
  // Diesel variants (drawn last so earlier seeds keep their configurations): compression ignition
  // needs CR ≥ 14 and diesels rarely exceed ≈ 5200 rpm.
  if (layout !== "radial" && rnd() < 0.2 && opts.diesel !== false) {
    config.quick.fuel = "diesel";
    config.quick.redline = Math.round(Math.min(5200, Math.max(2500, redline * 0.55)) / 100) * 100;
    if (ph.compressionRatio !== undefined) ph.compressionRatio = 14 + rnd() * 8;
    ph.pilotInjection = rnd() < 0.5;
    if (rnd() < 0.3) ph.cetaneNumber = 40 + rnd() * 15;
  }
  // Two-stroke variants (drawn last): crankcase-scavenged singles to fours, ≤ 0.5 L per cylinder,
  // naturally aspirated spark ignition.
  if (opts.twoStroke !== false && n <= 4 && layout !== "radial" && layout !== "w" && rnd() < 0.15) {
    config.quick.cycle = "two-stroke";
    config.quick.fuel = "gasoline";
    config.quick.aspiration = "na";
    config.forcedInduction = { type: "na" };
    config.quick.displacement = Math.round(n * Math.min(perCyl, 0.5) * 100) / 100;
    config.quick.redline = Math.round(Math.min(14000, Math.max(5000, redline)) / 100) * 100;
    if (ph.compressionRatio !== undefined) ph.compressionRatio = 9 + rnd() * 6;
    delete ph.pilotInjection;
    delete ph.cetaneNumber;
    ph.twoStrokeIntake = rnd() < 0.8 ? "reed" : "piston-port";
    ph.expansionChamber = rnd() < 0.85;
    if (rnd() < 0.3) ph.scavengeQuality = 1 + rnd() * 1.5;
  }
  // Rotary variants (drawn last): 1–4 rotors, 0.3–0.9 L per rotor, any aspiration and porting.
  if (opts.rotary !== false && config.quick.cycle !== "two-stroke" && rnd() < 0.12) {
    const rotors = 1 + Math.floor(rnd() * 4);
    config.quick.cycle = "rotary";
    config.quick.fuel = "gasoline";
    config.quick.layout = "inline";
    config.quick.cylinderCount = rotors;
    config.quick.displacement = Math.round(rotors * (0.3 + rnd() * 0.6) * 100) / 100;
    config.quick.redline = Math.round((6000 + rnd() * 4000) / 100) * 100;
    if (ph.compressionRatio !== undefined) ph.compressionRatio = 8 + rnd() * 2.5;
    delete ph.pilotInjection;
    delete ph.cetaneNumber;
    if (rnd() < 0.3) ph.rotaryExhaustPort = pick(["peripheral", "side"] as const);
  }
  config.physical = ph as EngineConfiguration["physical"];
  return config;
}

export interface FuzzResult {
  seed: number;
  ok: boolean;
  problems: string[];
  idleRpm: number;
  wotRpm: number;
  cpu: number;
  summary: string;
}

export function runConfig(seed: number, fs = 48000, opts: FuzzOptions = {}): FuzzResult {
  const problems: string[] = [];
  const config = randomConfig(seed, opts);
  const q = config.quick;
  const summary = `${q.cylinderCount}-cyl ${q.layout} ${q.displacement} L ${q.crankshaft} ${config.forcedInduction.type}${q.fuel === "diesel" ? " diesel" : ""}${q.cycle === "two-stroke" ? " two-stroke" : q.cycle === "rotary" ? " rotary" : ""} redline ${q.redline}`;
  let idleRpm = 0;
  let wotRpm = 0;
  let cpu = 0;
  try {
    const spec = resolveEngineSpec(config);
    const buf = new Float32Array(4800);
    const bufR = new Float32Array(4800);
    const finite = (label: string, sim: EngineSimulator) => {
      sim.process(buf, bufR, buf.length);
      for (let i = 0; i < buf.length; i++) {
        if (!Number.isFinite(buf[i])) {
          problems.push(`${label}: non-finite audio`);
          return;
        }
      }
      if (!Number.isFinite(sim.rpm)) problems.push(`${label}: non-finite rpm`);
    };
    const idle = new EngineSimulator(spec, fs);
    idle.setControls({ mode: "free", throttle: 0 });
    idle.prewarm(2);
    finite("idle", idle);
    idleRpm = idle.rpm;
    if (idle.rpm < spec.calibration.idleRpm * 0.4) problems.push(`idle stalls (${idle.rpm.toFixed(0)} rpm, target ${spec.calibration.idleRpm})`);
    if (idle.rpm > spec.calibration.idleRpm * 2.2) problems.push(`idle runs away (${idle.rpm.toFixed(0)} rpm, target ${spec.calibration.idleRpm})`);

    const wot = new EngineSimulator(spec, fs);
    const target = Math.round(spec.calibration.redlineRpm * 0.7);
    wot.setControls({ mode: "dyno", targetRpm: target, throttle: 1 });
    wot.prewarm(1.2);
    const t0 = performance.now();
    finite("wot", wot);
    cpu = (performance.now() - t0) / 1000 / (buf.length / fs);
    wotRpm = wot.rpm;
    if (Math.abs(wot.rpm / target - 1) > 0.25) problems.push(`dyno cannot hold ${target} rpm (${wot.rpm.toFixed(0)})`);
    if (wot.telemetry.brakeTorqueNm <= 0) problems.push(`no positive brake torque at full load (${wot.telemetry.brakeTorqueNm.toFixed(0)} N·m)`);
    wot.setControls({ throttle: 0 });
    wot.prewarm(0.5);
    finite("overrun", wot);

    const rev = new EngineSimulator(spec, fs);
    rev.setControls({ mode: "free", throttle: 0 });
    rev.prewarm(1);
    rev.setControls({ throttle: 1 });
    let peak = 0;
    for (let k = 0; k < 15; k++) {
      rev.prewarm(0.1);
      peak = Math.max(peak, rev.rpm);
    }
    finite("free-rev", rev);
    if (peak > spec.calibration.revLimiterRpm * 1.12) problems.push(`free rev overshoots the limiter (${peak.toFixed(0)} vs ${spec.calibration.revLimiterRpm})`);
  } catch (e) {
    problems.push(`exception: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { seed, ok: problems.length === 0, problems, idleRpm, wotRpm, cpu, summary };
}

