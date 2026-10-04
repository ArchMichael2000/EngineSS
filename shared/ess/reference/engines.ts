/**
 * Reference engines for the v16 physical core.
 *
 * Geometry (bore, stroke, rod, compression, layout, bank angle, crank, firing order, redline) is
 * from manufacturers' published specifications as widely documented. Valvetrain and induction data
 * marked "engine-sim" or "EngineLab" come from those projects' MIT-licensed engine definitions
 * (github.com/ange-yaghi/engine-sim, github.com/zolaski333/EngineLab); everything else falls back
 * to resolveEngineSpec()'s family defaults and is marked "estimated". Exhaust systems are
 * representative builds for the vehicle class, not measured hardware. Cam-phaser authorities and
 * lift-switch speeds follow the manufacturers' system descriptions (VANOS, VVT-i, AVCS, VTC/VTEC,
 * VarioCam) and are approximate.
 */
import type { EngineConfiguration } from "../../engineTypes";

export type Provenance = "published" | "engine-sim" | "EngineLab" | "estimated";

export interface ReferenceEngine {
  name: string;
  description: string;
  /** What each group of parameters is based on. */
  provenance: Partial<Record<"geometry" | "valvetrain" | "induction" | "exhaust" | "boost", Provenance>>;
  /** Published figures the simulation can be checked against. */
  published?: { peakTorqueNm?: [number, number]; peakPowerKw?: [number, number] };
  config: EngineConfiguration;
}

const v16 = { soundProfile: "v16" as const };

export const REFERENCE_ENGINES: Record<string, ReferenceEngine> = {
  "gm-ls3": {
    name: "GM LS3 6.2 V8",
    description: "Pushrod cross-plane V8, 1-8-7-2-6-5-4-3, dual exhaust with X-pipe",
    provenance: { geometry: "published", valvetrain: "published", induction: "estimated", exhaust: "estimated" },
    published: { peakTorqueNm: [575, 4600], peakPowerKw: [321, 5900] },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 8, displacement: 6.16, crankshaft: "cross-plane", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 6600 },
      advanced: { bore: 103.25, stroke: 92, bankAngle: 90, firingOrder: [1, 8, 7, 2, 6, 5, 4, 3], exhaustRouting: "dual" },
      physical: { rodLengthMm: 155, compressionRatio: 10.7, valvesPerCylinder: 2, intakeValveDiameterMm: 55, exhaustValveDiameterMm: 40.4, intakeDurationDeg: 204, exhaustDurationDeg: 211, intakeCenterlineDeg: 117, exhaustCenterlineDeg: 117, intakeLiftMm: 14.0, exhaustLiftMm: 13.3, throttleDiameterMm: 90, crossover: "x-pipe", idleRpm: 700 },
      forcedInduction: { type: "na" },
    },
  },
  "ferrari-f136": {
    name: "Ferrari F136 FB 4.5 V8",
    description: "Flat-plane 90° V8, 9000 rpm, race-type 4-into-1 per bank",
    provenance: { geometry: "published", valvetrain: "estimated", exhaust: "estimated" },
    published: { peakTorqueNm: [540, 6000], peakPowerKw: [425, 9000] },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 8, displacement: 4.5, crankshaft: "flat-plane", aspiration: "na", exhaustCharacter: "race", idleCharacter: "smooth", redline: 9000 },
      advanced: { bore: 94, stroke: 81, bankAngle: 90, revLimiterRpm: 9200 },
      physical: { compressionRatio: 12.5, rodLengthMm: 140, intakePhaserDeg: 50, exhaustPhaserDeg: 40 },
      forcedInduction: { type: "na" },
    },
  },
  "toyota-2jz-gte": {
    name: "Toyota 2JZ-GTE 3.0 I6 turbo",
    description: "Inline six, 1-5-3-6-2-4, single large turbo conversion",
    provenance: { geometry: "published", valvetrain: "engine-sim", boost: "estimated" },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 6, displacement: 3.0, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 6800 },
      advanced: { bore: 86, stroke: 86, firingOrder: [1, 5, 3, 6, 2, 4] },
      physical: { rodLengthMm: 142, compressionRatio: 8.5, intakeDurationDeg: 220, exhaustDurationDeg: 220, intakeCenterlineDeg: 116, exhaustCenterlineDeg: 116, intakeLiftMm: 9.78, exhaustLiftMm: 9.6, camLobeGamma: 1.1, intakePhaserDeg: 40 },
      forcedInduction: { type: "turbo", turboSize: "large", maxBoost: 18, wastegateEnabled: true, bovEnabled: true },
    },
  },
  "bmw-s54": {
    name: "BMW S54 3.2 I6",
    description: "8000 rpm inline six on individual throttle bodies",
    provenance: { geometry: "published", induction: "published", exhaust: "estimated" },
    published: { peakTorqueNm: [365, 4900], peakPowerKw: [252, 7900] },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 6, displacement: 3.25, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 8000 },
      advanced: { bore: 87, stroke: 91, intakeType: "itbs", firingOrder: [1, 5, 3, 6, 2, 4] },
      physical: { compressionRatio: 11.5, rodLengthMm: 139, intakePhaserDeg: 60, exhaustPhaserDeg: 45 },
      forcedInduction: { type: "na" },
    },
  },
  "honda-k20a": {
    name: "Honda K20A 2.0 I4",
    description: "8400 rpm DOHC four, 4-2-1 header",
    provenance: { geometry: "published", valvetrain: "EngineLab", exhaust: "EngineLab" },
    published: { peakTorqueNm: [206, 7000], peakPowerKw: [162, 8000] },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 4, displacement: 2.0, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 8400 },
      advanced: { bore: 86, stroke: 86, firingOrder: [1, 3, 4, 2] },
      physical: { compressionRatio: 11.5, rodLengthMm: 139, collector: "pairs-then-bank", primaryDiameterMm: 45, intakeDurationDeg: 205, exhaustDurationDeg: 200, intakeLiftMm: 8.0, exhaustLiftMm: 7.5, intakePhaserDeg: 50, liftSwitchRpm: 5800, highCamIntakeDurationDeg: 245, highCamExhaustDurationDeg: 240, highCamIntakeLiftMm: 11.5, highCamExhaustLiftMm: 10.8 },
      forcedInduction: { type: "na" },
    },
  },
  "subaru-ej257": {
    name: "Subaru EJ257 2.5 flat-4 turbo",
    description: "Boxer four with unequal-length headers — the classic rumble",
    provenance: { geometry: "published", valvetrain: "engine-sim", exhaust: "engine-sim", boost: "estimated" },
    config: {
      ...v16,
      quick: { layout: "flat", cylinderCount: 4, displacement: 2.46, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 7000 },
      advanced: { bore: 99.5, stroke: 79, headerGeometry: "unequal-length", firingOrder: [1, 3, 2, 4] },
      physical: { compressionRatio: 8.2, rodLengthMm: 130.5, intakeDurationDeg: 232, exhaustDurationDeg: 236, intakeCenterlineDeg: 117, exhaustCenterlineDeg: 112, intakeLiftMm: 9.78, exhaustLiftMm: 9.6, camLobeGamma: 2.0, intakePhaserDeg: 35 },
      forcedInduction: { type: "turbo", turboSize: "balanced", maxBoost: 14.5, wastegateEnabled: true, bovEnabled: true },
    },
  },
  "porsche-9a1": {
    name: "Porsche 9A1 3.8 flat-6",
    description: "Water-cooled boxer six, 7800 rpm",
    provenance: { geometry: "published", exhaust: "estimated" },
    published: { peakTorqueNm: [420, 4400], peakPowerKw: [283, 6500] },
    config: {
      ...v16,
      quick: { layout: "flat", cylinderCount: 6, displacement: 3.8, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 7800 },
      advanced: { bore: 102, stroke: 77.5, firingOrder: [1, 6, 2, 4, 3, 5] },
      physical: { compressionRatio: 12.5, intakePhaserDeg: 50, exhaustPhaserDeg: 40 },
      forcedInduction: { type: "na" },
    },
  },
  "audi-ea855": {
    name: "Audi 2.5 TFSI inline-5",
    description: "1-2-4-5-3 five-cylinder warble, turbocharged",
    provenance: { geometry: "published", boost: "estimated" },
    published: { peakTorqueNm: [480, 2000], peakPowerKw: [294, 6000] },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 5, displacement: 2.48, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 7000 },
      advanced: { bore: 82.5, stroke: 92.8, firingOrder: [1, 2, 4, 5, 3] },
      physical: { compressionRatio: 10.0, rodLengthMm: 144, intakePhaserDeg: 42, exhaustPhaserDeg: 22 },
      forcedInduction: { type: "turbo", turboSize: "small", maxBoost: 20, wastegateEnabled: true, bovEnabled: true },
    },
  },
  "lexus-1lr-gue": {
    name: "Lexus 1LR-GUE 4.8 V10",
    description: "72° even-fire V10, 9000 rpm, equal-length 5-into-1",
    provenance: { geometry: "published", exhaust: "estimated" },
    published: { peakTorqueNm: [480, 6800], peakPowerKw: [412, 8700] },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 10, displacement: 4.8, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "race", idleCharacter: "smooth", redline: 9000 },
      advanced: { bore: 88, stroke: 79, bankAngle: 72 },
      physical: { compressionRatio: 12.0, crankType: "common-pin", intakePhaserDeg: 50, exhaustPhaserDeg: 40 },
      forcedInduction: { type: "na" },
    },
  },
  "ferrari-f140": {
    name: "Ferrari F140 6.3 V12",
    description: "65° V12, 8700 rpm",
    provenance: { geometry: "published", exhaust: "estimated" },
    published: { peakTorqueNm: [690, 6000], peakPowerKw: [545, 8250] },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 12, displacement: 6.26, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "race", idleCharacter: "smooth", redline: 8700 },
      advanced: { bore: 94, stroke: 75.2, bankAngle: 65 },
      physical: { compressionRatio: 13.5, intakePhaserDeg: 50, exhaustPhaserDeg: 40 },
      forcedInduction: { type: "na" },
    },
  },
  "harley-m8-107": {
    name: "Harley-Davidson Milwaukee-Eight 107",
    description: "45° common-pin V-twin: 315°/405° firing — the potato-potato",
    provenance: { geometry: "published", exhaust: "estimated" },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 2, displacement: 1.75, crankshaft: "odd-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 5500 },
      advanced: { bore: 100, stroke: 111.1, bankAngle: 45, exhaustRouting: "single" },
      physical: { crankType: "common-pin", compressionRatio: 10.0, valvesPerCylinder: 4, idleRpm: 850, inertiaKgM2: 0.09, outletSpacingM: 0.3 },
      forcedInduction: { type: "na" },
    },
  },
  "ducati-1299": {
    name: "Ducati Superquadro 1299",
    description: "90° L-twin, 270°/450°, 11 500 rpm",
    provenance: { geometry: "published", exhaust: "estimated" },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 2, displacement: 1.285, crankshaft: "odd-fire", aspiration: "na", exhaustCharacter: "race", idleCharacter: "smooth", redline: 11500 },
      advanced: { bore: 116, stroke: 60.8, bankAngle: 90, exhaustRouting: "single" },
      physical: { crankType: "common-pin", compressionRatio: 12.6, idleRpm: 1200 },
      forcedInduction: { type: "na" },
    },
  },
  "yamaha-cp4": {
    name: "Yamaha CP4 (R1) crossplane I4",
    description: "Crossplane inline-4: 270-180-90-180 firing",
    provenance: { geometry: "published", exhaust: "EngineLab" },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 4, displacement: 0.998, crankshaft: "cross-plane", aspiration: "na", exhaustCharacter: "race", idleCharacter: "smooth", redline: 14000 },
      advanced: { bore: 79, stroke: 50.9, firingOrder: [1, 3, 2, 4] },
      physical: { compressionRatio: 13.0, collector: "pairs-then-bank", idleRpm: 1300 },
      forcedInduction: { type: "na" },
    },
  },
  "yamaha-cp3": {
    name: "Yamaha CP3 (MT-09) inline-3",
    description: "240° crossplane triple",
    provenance: { geometry: "published", exhaust: "estimated" },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 3, displacement: 0.89, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 11000 },
      advanced: { bore: 78, stroke: 62.1, firingOrder: [1, 2, 3] },
      physical: { compressionRatio: 11.5, crankType: "common-pin", idleRpm: 1200 },
      forcedInduction: { type: "na" },
    },
  },
  "buick-231-oddfire": {
    name: "Buick 231 odd-fire V6",
    description: "90° V6 on three shared crankpins: 90°/150° alternating",
    provenance: { geometry: "published", exhaust: "estimated" },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 6, displacement: 3.8, crankshaft: "odd-fire", aspiration: "na", exhaustCharacter: "stock", idleCharacter: "smooth", redline: 4800 },
      advanced: { bore: 96.5, stroke: 86.4, bankAngle: 90, firingOrder: [1, 6, 5, 4, 3, 2], exhaustRouting: "single" },
      physical: { crankType: "common-pin", compressionRatio: 8.0, valvesPerCylinder: 2 },
      forcedInduction: { type: "na" },
    },
  },
  "nissan-vr38": {
    name: "Nissan VR38DETT 3.8 V6",
    description: "60° split-pin V6, twin turbo",
    provenance: { geometry: "published", boost: "estimated" },
    published: { peakTorqueNm: [632, 3300], peakPowerKw: [419, 6800] },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 6, displacement: 3.8, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 7100 },
      advanced: { bore: 95.5, stroke: 88.4, bankAngle: 60 },
      physical: { compressionRatio: 9.0, turboCount: 2, intakePhaserDeg: 35 },
      forcedInduction: { type: "turbo", turboSize: "balanced", maxBoost: 10, wastegateEnabled: true, bovEnabled: true },
    },
  },
  "hellcat-6-2": {
    name: "SRT Hellcat 6.2 supercharged V8",
    description: "Cross-plane Hemi V8 with 2.4 L twin-screw blower",
    provenance: { geometry: "published", boost: "published" },
    published: { peakTorqueNm: [881, 4000], peakPowerKw: [527, 6000] },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 8, displacement: 6.17, crankshaft: "cross-plane", aspiration: "supercharged", exhaustCharacter: "sport", idleCharacter: "lumpy", redline: 6200 },
      advanced: { bore: 103.9, stroke: 90.9, bankAngle: 90, firingOrder: [1, 8, 4, 3, 6, 5, 7, 2], exhaustRouting: "dual" },
      physical: { compressionRatio: 9.5, valvesPerCylinder: 2, superchargerDisplacementL: 2.38 },
      forcedInduction: { type: "supercharged", superchargerType: "twin-screw", superchargerBoost: 11.6, whineIntensity: 0.7 },
    },
  },
  "pw-r985": {
    name: "Pratt & Whitney R-985 Wasp Junior",
    description: "Nine-cylinder single-row radial, collector ring",
    provenance: { geometry: "published", exhaust: "estimated" },
    config: {
      ...v16,
      quick: { layout: "radial", cylinderCount: 9, displacement: 16.1, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "straight-pipe", idleCharacter: "smooth", redline: 2300 },
      advanced: { bore: 131.8, stroke: 131.8, exhaustRouting: "single" },
      physical: { compressionRatio: 6.0, crankType: "single-pin", valvesPerCylinder: 2, collector: "all", idleRpm: 600 },
      forcedInduction: { type: "na" },
    },
  },
  "merlin-v12": {
    name: "Rolls-Royce Merlin V12",
    description: "60° V12, short ejector stacks (open primaries)",
    provenance: { geometry: "published", exhaust: "published", boost: "estimated" },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 12, displacement: 27, crankshaft: "even-fire", aspiration: "supercharged", exhaustCharacter: "straight-pipe", idleCharacter: "smooth", redline: 3000 },
      advanced: { bore: 137.2, stroke: 152.4, bankAngle: 60, exhaustRouting: "open-headers", primaryTubeLengthCm: 25 },
      physical: { compressionRatio: 6.0, crankType: "common-pin", collector: "none", idleRpm: 600, valvesPerCylinder: 4 },
      forcedInduction: { type: "supercharged", superchargerType: "centrifugal", superchargerBoost: 12, whineIntensity: 0.5 },
    },
  },
  "bugatti-w16": {
    name: "Bugatti W16 8.0 quad-turbo",
    description: "Two narrow-angle VR8 banks at 90°, four turbochargers",
    provenance: { geometry: "published", boost: "estimated" },
    published: { peakTorqueNm: [1250, 2200], peakPowerKw: [736, 6000] },
    config: {
      ...v16,
      quick: { layout: "w", cylinderCount: 16, displacement: 7.99, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 6700 },
      advanced: { bore: 86, stroke: 86, bankAngle: 90 },
      physical: { compressionRatio: 9.0, vrAngleDeg: 15, turboCount: 4, intakePhaserDeg: 40 },
      forcedInduction: { type: "turbo", turboSize: "small", maxBoost: 11.5, wastegateEnabled: true, bovEnabled: true },
    },
  },
  "vw-vr6": {
    name: "VW VR6 2.8 (15° narrow V)",
    description: "Six cylinders in a 15° V under one head, even-fire",
    provenance: { geometry: "published", exhaust: "estimated" },
    config: {
      ...v16,
      quick: { layout: "v", cylinderCount: 6, displacement: 2.79, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 6500 },
      advanced: { bore: 81, stroke: 90.3, bankAngle: 15, exhaustRouting: "single", firingOrder: [1, 5, 3, 6, 2, 4] },
      physical: { compressionRatio: 10.0, valvesPerCylinder: 2, intakePhaserDeg: 52, exhaustPhaserDeg: 22 },
      forcedInduction: { type: "na" },
    },
  },
  "vw-ea288": {
    name: "VW EA288 2.0 TDI (110 kW)",
    description: "Common-rail inline-4 diesel with pilot injection, VGT-style small turbo",
    provenance: { geometry: "published", boost: "estimated", exhaust: "estimated" },
    published: { peakTorqueNm: [340, 2000], peakPowerKw: [110, 3750] },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 4, displacement: 1.968, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "stock", idleCharacter: "smooth", redline: 4800, fuel: "diesel" },
      advanced: { bore: 81, stroke: 95.5, firingOrder: [1, 3, 4, 2] },
      physical: { compressionRatio: 16.2, pilotInjection: true },
      forcedInduction: { type: "turbo", turboSize: "small", maxBoost: 17 },
    },
  },
  "cummins-6bt": {
    name: "Cummins 6BT 5.9 12-valve (1994)",
    description: "Inline-6 diesel, mechanical P7100 injection pump (no pilot): the classic diesel clatter",
    provenance: { geometry: "published", boost: "estimated", exhaust: "estimated" },
    published: { peakTorqueNm: [542, 1600], peakPowerKw: [119, 2500] },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 6, displacement: 5.88, crankshaft: "even-fire", aspiration: "turbo", exhaustCharacter: "stock", idleCharacter: "smooth", redline: 2700, fuel: "diesel" },
      advanced: { bore: 102, stroke: 120, firingOrder: [1, 5, 3, 6, 2, 4], revLimiterRpm: 2800 },
      // Fuel plate from the published BMEP (11.6 bar at η_b ≈ 0.40): ≈ 66 mg per stroke.
      physical: { compressionRatio: 17.5, valvesPerCylinder: 2, pilotInjection: false, injectionAdvanceDeg: 13, idleRpm: 750, dieselFullLoadFuelMg: 66 },
      forcedInduction: { type: "turbo", turboSize: "small", maxBoost: 17 },
    },
  },
  "yamaha-rd350lc": {
    name: "Yamaha RD350LC (4L0) two-stroke twin",
    description: "Liquid-cooled 180° parallel twin, reed-valve induction, tuned expansion chambers",
    provenance: { geometry: "published", exhaust: "estimated" },
    published: { peakTorqueNm: [40, 8000], peakPowerKw: [34.6, 8500] },
    config: {
      ...v16,
      quick: { layout: "inline", cylinderCount: 2, displacement: 0.347, crankshaft: "even-fire", aspiration: "na", exhaustCharacter: "sport", idleCharacter: "smooth", redline: 9500, cycle: "two-stroke" },
      advanced: { bore: 64, stroke: 54 },
      // Yamaha's 6.2:1 is the trapped ratio; ≈ 12.2:1 geometric with the exhaust port at 87° ATDC.
      physical: { compressionRatio: 12.2, twoStrokeIntake: "reed", idleRpm: 1200 },
      forcedInduction: { type: "na" },
    },
  },
};
