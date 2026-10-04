/**
 * Map the app's Quick/Advanced engine configuration onto a complete physical
 * EngineSpec. Explicit values (advanced fields, `physical` overrides) always win;
 * everything else is filled with family-typical engineering values. The rules
 * and their sources are listed in docs/reference-sources.md ("Spec defaults").
 */
import type { EngineConfiguration } from "../engineTypes";
import type { CamSpec, CollectorStrategy, CrossoverType, EngineSpec, EssCrankType, ExhaustRoutingType, ForcedInductionSpec, MufflerSpec } from "./spec";
import { clamp } from "./gas";
import { bankLayout } from "./geometry";

interface CamPreset {
  intake: number;
  exhaust: number;
  icl: number;
  ecl: number;
}

/** Duration at 0.050" and lobe centrelines by idle character (street → full race). */
const CAMS: Record<EngineConfiguration["quick"]["idleCharacter"], CamPreset> = {
  smooth: { intake: 206, exhaust: 210, icl: 114, ecl: 116 },
  lumpy: { intake: 226, exhaust: 232, icl: 109, ecl: 113 },
  aggressive: { intake: 244, exhaust: 250, icl: 106, ecl: 111 },
  lopey: { intake: 262, exhaust: 268, icl: 104, ecl: 108 },
};

const IDLE_RPM: Record<EngineConfiguration["quick"]["idleCharacter"], number> = {
  smooth: 750,
  lumpy: 850,
  aggressive: 950,
  lopey: 1050,
};

export function resolveEngineSpec(config: EngineConfiguration): EngineSpec {
  const q = config.quick;
  const adv = config.advanced ?? {};
  const ph = config.physical ?? {};
  const fiCfg = config.forcedInduction;
  const n = clamp(Math.round(q.cylinderCount), 1, 24);
  const layout = n === 1 ? "inline" : q.layout;
  const displacement = clamp(q.displacement, 0.05, 30);
  const perCyl = displacement / n;
  const motorcycleLike = q.redline >= 10_000 && displacement <= 1.6;
  const aircraftLike = layout === "radial" || (q.redline <= 3200 && perCyl > 1.5);

  // ---- Bore / stroke
  const defaultRatio = layout === "flat" ? 1.28 : layout === "radial" ? 1.0 : motorcycleLike ? 1.45 : layout === "v" && n >= 8 ? 1.1 : n <= 4 ? 0.98 : 1.04;
  let bore: number;
  let stroke: number;
  if (adv.bore && adv.stroke) {
    bore = adv.bore;
    stroke = adv.stroke;
  } else {
    const ratio = adv.bore && !adv.stroke ? undefined : defaultRatio;
    if (adv.stroke && !adv.bore) {
      stroke = adv.stroke;
      bore = Math.sqrt((perCyl * 1e6 * 4) / (Math.PI * stroke));
    } else if (adv.bore && !ratio) {
      bore = adv.bore;
      stroke = (perCyl * 1e6 * 4) / (Math.PI * bore * bore);
    } else {
      // V = π/4·B²·S, S = B/ratio → B = (4V·ratio/π)^(1/3)
      bore = Math.cbrt((4 * perCyl * 1e6 * defaultRatio) / Math.PI);
      stroke = bore / defaultRatio;
    }
  }
  const rod = ph.rodLengthMm ?? stroke * (motorcycleLike ? 1.75 : 1.62);

  // ---- Crank
  const crankType: EssCrankType = ph.crankType ?? mapCrank(q.crankshaft, layout);
  const bankAngle = adv.bankAngle ?? defaultBankAngle(layout, n);

  // ---- Valvetrain
  const pushrod = layout === "v" && n >= 8 && q.redline <= 7000 && !motorcycleLike;
  const valvesPerCyl = ph.valvesPerCylinder ?? (aircraftLike || pushrod ? 2 : 4);
  const inCount = valvesPerCyl >= 4 ? (valvesPerCyl === 5 ? 3 : 2) : valvesPerCyl === 3 ? 2 : 1;
  const exCount = valvesPerCyl >= 4 ? 2 : 1;
  const inD = ph.intakeValveDiameterMm ?? (inCount === 1 ? 0.52 * bore : inCount === 2 ? 0.39 * bore : 0.31 * bore);
  const exD = ph.exhaustValveDiameterMm ?? (exCount === 1 ? 0.41 * bore : 0.33 * bore);
  const camPreset = CAMS[q.idleCharacter];
  const highRev = clamp((q.redline - 6500) / 3000, 0, 1);
  const cam: CamSpec = {
    intakeDurationDeg: ph.intakeDurationDeg ?? camPreset.intake + highRev * 18,
    exhaustDurationDeg: ph.exhaustDurationDeg ?? camPreset.exhaust + highRev * 18,
    intakeCenterlineDeg: ph.intakeCenterlineDeg ?? camPreset.icl,
    exhaustCenterlineDeg: ph.exhaustCenterlineDeg ?? camPreset.ecl,
    intakeLiftMm: ph.intakeLiftMm ?? inD * (inCount === 1 ? 0.27 : 0.29) * (1 + 0.1 * highRev),
    exhaustLiftMm: ph.exhaustLiftMm ?? exD * (exCount === 1 ? 0.3 : 0.31) * (1 + 0.1 * highRev),
    gamma: ph.camLobeGamma ?? 0.8,
    intakePhaserDeg: clamp(ph.intakePhaserDeg ?? 0, 0, 80),
    exhaustPhaserDeg: clamp(ph.exhaustPhaserDeg ?? 0, 0, 80),
    liftSwitch: null,
  };
  if (ph.liftSwitchRpm) {
    // High cam defaults: the classic VTEC/MIVEC step, ≈ +30° duration and +20 % lift.
    cam.liftSwitch = {
      switchRpm: ph.liftSwitchRpm,
      intakeDurationDeg: ph.highCamIntakeDurationDeg ?? cam.intakeDurationDeg + 30,
      exhaustDurationDeg: ph.highCamExhaustDurationDeg ?? cam.exhaustDurationDeg + 30,
      intakeLiftMm: ph.highCamIntakeLiftMm ?? cam.intakeLiftMm * 1.2,
      exhaustLiftMm: ph.highCamExhaustLiftMm ?? cam.exhaustLiftMm * 1.2,
    };
  }

  // ---- Intake
  const intakeType = adv.intakeType ?? "single-throttle-body";
  const runnerLen = adv.intakeRunnerLengthCm ? adv.intakeRunnerLengthCm * 10 : motorcycleLike ? 160 : q.redline > 8000 ? 210 : intakeType === "itbs" || intakeType === "velocity-stacks" ? 260 : 300;
  const intake = {
    type: intakeType,
    plenumVolumeL: ph.plenumVolumeL ?? clamp(displacement * 1.05, 0.8, 12),
    throttleDiameterMm: ph.throttleDiameterMm ?? clamp(45 * Math.pow(displacement, 0.4), 28, 120),
    // Manifold runner plus the cylinder-head port (~1.2 × bore) — the length that sets ram tuning.
    runnerLengthMm: runnerLen + 1.2 * bore,
    runnerDiameterMm: ph.runnerDiameterMm ?? inD * Math.sqrt(inCount) * 0.92,
    airboxVolumeL: intakeType === "itbs" || intakeType === "velocity-stacks" ? 0 : intakeType === "carb" ? 1.2 : displacement * 1.2 + 4,
    snorkelLengthMm: intakeType === "carb" ? 60 : 380,
    snorkelDiameterMm: clamp(58 + 19 * Math.sqrt(displacement), 50, 140),
    filter: ph.airFilter ?? (intakeType === "velocity-stacks" ? "none" : intakeType === "itbs" ? "sock" : intakeType === "carb" ? "cone" : "oem-paper"),
    idleBypassAreaMm2: 22 * displacement + 25,
  } as EngineSpec["intake"];

  // ---- Exhaust
  const character = q.exhaustCharacter;
  const routing: ExhaustRoutingType = adv.exhaustRouting ?? ((layout === "v" || layout === "flat" || layout === "w") && n >= 6 ? "dual" : "single");
  const crossPlaneV8 = layout === "v" && n === 8 && q.crankshaft === "cross-plane";
  const collector: CollectorStrategy = ph.collector ?? (layout === "radial" ? "all" : n === 4 && layout === "inline" && character !== "stock" ? "pairs-then-bank" : "bank");
  const primaryD = ph.primaryDiameterMm ?? clamp(24 + 25 * Math.sqrt(perCyl), 28, 64);
  const basePrimary = adv.primaryTubeLengthCm ? adv.primaryTubeLengthCm * 10 : character === "stock" ? 420 : character === "sport" ? 620 : 760;
  // Header primary plus the exhaust port in the head (~1.0 × bore).
  const portMm = bore * 1.0;
  const primaryLengths = ph.primaryLengthsMm?.length === n ? ph.primaryLengthsMm : primaryLengthsFor(layout, n, bankAngle, basePrimary, adv.headerGeometry ?? (layout === "flat" && n === 4 && character !== "race" ? "unequal-length" : "equal-length"), bore).map((l) => l + portMm);
  const groups = collector === "all" ? 1 : routing === "dual" || layout !== "inline" ? Math.max(1, Math.min(2, layout === "inline" ? (n >= 6 ? 2 : 1) : 2)) : n >= 6 ? 2 : 1;
  const perGroup = Math.max(1, n / groups);
  const pipeD = ph.pipeDiameterMm ?? clamp(34 + 17 * Math.sqrt(displacement / (routing === "dual" ? 2 : 1)), 38, 110);
  const muffler = resolveMuffler(character, crossPlaneV8, pipeD, adv.mufflerVolumeL, ph.muffler, ph.mufflerPacking);
  const totalLen = adv.exhaustLengthCm ? adv.exhaustLengthCm * 10 : motorcycleLike ? 1300 : character === "stock" ? 4200 : character === "sport" ? 3900 : character === "race" ? 3500 : 3300;
  const fixed = basePrimary + 220 + 900 + 450 + 600 + (character === "stock" || character === "sport" ? 450 : 0) + (character === "stock" ? 400 : 0) + muffler.bodyLengthMm;
  const exhaust: EngineSpec["exhaust"] = {
    routing,
    primaryLengthsMm: primaryLengths,
    primaryDiameterMm: primaryD,
    collector,
    collectorDiameterMm: ph.collectorDiameterMm ?? clamp(primaryD * Math.sqrt(perGroup) * 0.78, primaryD * 1.1, 130),
    midPipeLengthMm: motorcycleLike ? 250 : 900,
    pipeDiameterMm: pipeD,
    crossover: (ph.crossover ?? (routing === "dual" ? (character === "stock" ? "h-pipe" : character === "sport" ? "x-pipe" : "none") : "none")) as CrossoverType,
    catalyst: ph.catalyst ?? (character === "stock" || character === "sport"),
    resonator: ph.resonator ?? character === "stock",
    muffler,
    tailpipeLengthMm: clamp(totalLen - fixed, 150, 2500),
    tailpipeDiameterMm: ph.tailpipeDiameterMm ?? pipeD * (character === "stock" ? 0.95 : 1.05),
    outletSpacingM: ph.outletSpacingM ?? (motorcycleLike ? 0.25 : 0.95),
  };

  // ---- Forced induction
  const forcedInduction = resolveForcedInduction(config, displacement, q.redline);

  // ---- Calibration
  const boosted = forcedInduction.kind !== "na";
  const idleRpm = ph.idleRpm ?? IDLE_RPM[q.idleCharacter] + (motorcycleLike ? 350 : 0) - (aircraftLike ? 200 : 0);
  const limiterRpm = adv.revLimiterRpm ?? q.redline;
  const afterfireByCharacter = { stock: 0.04, sport: 0.22, race: 0.5, "straight-pipe": 0.75 } as const;
  const calibration: EngineSpec["calibration"] = {
    idleRpm,
    redlineRpm: q.redline,
    revLimiterRpm: limiterRpm,
    revLimiter: adv.revLimiterType ?? "soft",
    fuelOctane: ph.fuelOctane ?? 95,
    knockControl: ph.knockControl ?? true,
    lambdaWot: boosted ? 0.8 : 0.87,
    lambdaPart: 1,
    overrunFuelCut: true,
    afterfireTendency: ph.afterfireTendency ?? afterfireByCharacter[character],
  };

  const inertia = ph.inertiaKgM2 ?? (motorcycleLike ? 0.012 + 0.012 * displacement : aircraftLike ? 0.6 + 0.08 * displacement : 0.06 + 0.022 * displacement);

  return {
    name: `${n}-cyl ${layout} ${displacement.toFixed(1)} L`,
    layout,
    cylinders: n,
    boreMm: bore,
    strokeMm: stroke,
    rodLengthMm: rod,
    compressionRatio: ph.compressionRatio ?? (boosted ? 9.4 : q.idleCharacter === "aggressive" || q.idleCharacter === "lopey" ? 11.6 : 10.8),
    bankAngleDeg: bankAngle,
    vrAngleDeg: ph.vrAngleDeg ?? 15,
    crank: {
      type: ph.fireAnglesDeg?.length === n ? "custom" : crankType,
      pinAnglesDeg: ph.crankPinAnglesDeg,
      fireAnglesDeg: ph.fireAnglesDeg,
    },
    firingOrder: adv.firingOrder?.length === n ? adv.firingOrder : [],
    valves: { intakeCount: inCount, exhaustCount: exCount, intakeDiameterMm: inD, exhaustDiameterMm: exD },
    cam,
    intake,
    exhaust,
    forcedInduction,
    calibration,
    inertiaKgM2: inertia,
    borePitchMm: bore * 1.12 + 9,
    fuelLhvMjKg: 43,
    fuelStoichAfr: 14.7,
    seed: config.seed ?? 42,
  };
}

function mapCrank(crank: EngineConfiguration["quick"]["crankshaft"], layout: string): EssCrankType {
  if (layout === "radial") return "single-pin";
  switch (crank) {
    case "cross-plane":
      return "cross-plane";
    case "flat-plane":
      return "flat-plane";
    case "odd-fire":
      return layout === "inline" ? "cross-plane" : "common-pin";
    case "even-fire":
    default:
      return "even-fire";
  }
}

function defaultBankAngle(layout: string, n: number): number {
  if (layout === "flat") return 180;
  if (layout === "w") return n >= 16 ? 90 : 72;
  if (layout !== "v") return 0;
  if (n === 2) return 45;
  if (n === 4) return 90;
  if (n === 6) return 60;
  if (n === 10) return 90;
  if (n === 12) return 60;
  if (n === 16) return 45;
  return 90;
}

/**
 * Equal-length headers keep every primary at the base length. Unequal-length
 * headers take the shortest path from each port to a collector at one end of
 * the bank — the Subaru-EJ "boxer rumble" geometry.
 */
function primaryLengthsFor(layout: string, n: number, bankAngle: number, base: number, geometry: string, boreMm: number): number[] {
  if (geometry !== "unequal-length") return Array(n).fill(base);
  const { bankOf, throwOf } = bankLayout(layout as never, n, bankAngle, 15);
  const pitch = boreMm * 1.12 + 9;
  const throws = Array.from({ length: n }, (_, i) => throwOf(i + 1));
  const maxThrow = Math.max(...throws);
  return Array.from({ length: n }, (_, i) => {
    const distanceToCollector = (maxThrow - throws[i]) * pitch;
    const crossover = layout === "flat" && bankOf(i + 1) === 1 ? 260 : 0;
    return Math.max(150, base * 0.7 + distanceToCollector * 1.4 + crossover);
  });
}

function resolveMuffler(character: string, crossPlaneV8: boolean, pipeD: number, volumeL: number | undefined, kind: MufflerSpec["type"] | undefined, packing: number | undefined): MufflerSpec {
  const type: MufflerSpec["type"] = kind ?? (character === "stock" ? "turbo" : character === "sport" ? (crossPlaneV8 ? "chambered" : "straight-through") : character === "race" ? "straight-through" : "none");
  const defaultVolume = character === "stock" ? 14 : character === "sport" ? 8 : 5;
  const volume = clamp(volumeL ?? defaultVolume, 0.5, 60);
  const bodyD = clamp(Math.cbrt((volume / 1000) * 4 / (Math.PI * 2.6)) * 1000, pipeD * 1.6, 320);
  const bodyL = clamp((volume / 1000) / (Math.PI * Math.pow(bodyD / 2000, 2)) * 1000, 150, 900);
  return {
    type,
    bodyDiameterMm: type === "straight-through" ? pipeD * 1.8 : bodyD,
    bodyLengthMm: bodyL,
    packing: packing ?? (character === "stock" ? 0.9 : character === "sport" ? 0.55 : 0.3),
  };
}

function resolveForcedInduction(config: EngineConfiguration, displacement: number, redline: number): ForcedInductionSpec {
  const fi = config.forcedInduction;
  const ph = config.physical ?? {};
  const kind = fi.type ?? config.quick.aspiration;
  if (kind === "turbo") {
    const size = fi.turboSize === "small" || fi.turboSize === "large" ? fi.turboSize : "balanced";
    const count = ph.turboCount ?? 1;
    const perTurboDisp = displacement / count;
    // Exducer sized so the boosted airflow at redline lands at φ = ṁ/(ρUD²) ≈ 0.12 (right of peak
    // efficiency, short of choke) at 470 m/s tip speed; small/large housings shift it ∓.
    const boostKpa = (fi.maxBoost ?? 15) * 6.895;
    const chargeDensity = ((101.3 + boostKpa) * 1000) / (287 * 320);
    const redlineFlow = (0.95 * chargeDensity * (perTurboDisp / 1000) * redline) / 120;
    const wheel = ph.compressorWheelMm ?? clamp(1000 * Math.sqrt(redlineFlow / (1.18 * 470 * 0.12)) * (size === "small" ? 0.94 : size === "large" ? 1.08 : 1), 32, 140);
    return {
      kind: "turbo",
      count,
      size,
      compressorWheelDiameterMm: wheel,
      compressorBlades: 6,
      turbineBlades: 11,
      // Total turbine nozzle area sized so the exhaust energy at the full-boost speed drives the
      // compressor: an energy balance (η_t 0.68, T3 ≈ 1100 K, PR_t ≈ 0.75·PR_c) gives ≈ 0.126 mm² per
      // litre·rpm, evaluated at the boost threshold, which sits ~20 % below the speed where full
      // boost is held (the low-boost equilibrium is stable until exhaust flow can bootstrap the
      // shaft). Small housings hold full boost near 0.28 × redline, large ones near 0.55.
      turbineAreaMm2: 0.126 * displacement * redline * (size === "small" ? 0.22 : size === "large" ? 0.45 : 0.32),
      rotorInertiaKgM2: 2.6e-5 * Math.pow(wheel / 50, 5) * count,
      targetBoostKpa: (fi.maxBoost ?? 15) * 6.895,
      wastegate: fi.wastegateEnabled ?? true,
      blowOffValve: fi.bovEnabled ?? true,
      chargeVolumeL: 2.5 + displacement * 0.6,
    };
  }
  if (kind === "supercharged") {
    const type = fi.superchargerType ?? "roots";
    const boostKpa = (fi.superchargerBoost ?? 10) * 6.895;
    const pr = 1 + boostKpa / 101.3;
    const scDisp = ph.superchargerDisplacementL ?? displacement * (type === "twin-screw" ? 0.36 : 0.38);
    // Rotor speed needed to deliver PR × the engine's swept flow at ~85% volumetric efficiency.
    const driveRatio = ph.superchargerDriveRatio ?? (type === "centrifugal" ? 2.6 : clamp((pr * displacement * 0.5 * 0.95) / (scDisp * 0.82), 1.4, 3.6));
    return {
      kind: "supercharger",
      type,
      displacementL: scDisp,
      driveRatio,
      // Centrifugal: step-up sized for ~380 m/s impeller tip speed at redline.
      stepUpRatio: type === "centrifugal" ? clamp(((400 / (Math.PI * clamp(90 * Math.sqrt(displacement / 3), 60, 140) / 1000)) * 60) / (redline * driveRatio), 2, 9) : 1,
      lobes: type === "twin-screw" ? 4 : 4,
      helixTwistDeg: type === "roots" ? 160 : 300,
      timingGearTeeth: type === "centrifugal" ? 38 : 40,
      impellerBlades: 8,
      impellerDiameterMm: clamp(90 * Math.sqrt(displacement / 3), 60, 140),
      bypassValve: true,
      targetBoostKpa: boostKpa,
      whineIntensity: fi.whineIntensity ?? 0.6,
    };
  }
  return { kind: "na" };
}
