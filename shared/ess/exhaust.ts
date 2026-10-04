/**
 * Exhaust system compiled from the spec into ducts, scattering junctions,
 * series resistances and radiating outlets.
 *
 * Topology: primary per cylinder (valve at end a) → collector per group
 * (4-1, tri-Y, 4-2-1 via pairs, 180° "firing-alternate", or none for open
 * primaries) → optional X/H crossover → catalyst → resonator → muffler →
 * tailpipe → unflanged radiation. Gas temperature falls along the system
 * with a cooling length that grows with mass flow, so every resonance moves
 * with load as it does on a real car.
 */
import type { EngineSpec } from "./spec";
import type { ExhaustGroup, FiringSchedule } from "./geometry";
import { exhaustGroups } from "./geometry";
import { BandNoise, C_AIR, P_AMBIENT, R_AIR, RHO_AIR, Rng, T_AMBIENT, clamp, orificeMassFlow } from "./gas";
import { Duct, Junction, RadiationLoad, ReservoirOrifice, ResistiveJoint, send } from "./waveguide";
import type { Port } from "./waveguide";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ExhaustOutlet {
  duct: Duct;
  load: RadiationLoad;
  position: Vec3;
  /** Outlet jet (turbulent mixing) noise generator. */
  jet: BandNoise;
  meanQ: number;
  /** Total monopole volume acceleration this sample (pipe radiation + jet), m³/s². */
  volumeAcceleration: number;
  diameter: number;
}

interface ChainDuct {
  duct: Duct;
  /** Distance of the duct centre from the exhaust ports, m. */
  distanceM: number;
  group: number;
}

export interface TurbineStage {
  manifold: Junction;
  downpipe: Duct;
  /** Full-open turbine effective area, m². */
  turbineArea: number;
  /** Wastegate open fraction 0..1 (set by the turbo controller). */
  wastegate: number;
  wastegateArea: number;
  massFlow: number;
  wastegateMassFlow: number;
  inletPa: number;
  inletK: number;
  outletPa: number;
  /** 0..1 nozzle area factor, may be set by the turbo model (rotor blockage). */
  areaFactor: number;
  orifice: ReservoirOrifice;
}

export class ExhaustNetwork {
  readonly primaries: Duct[];
  readonly primaryPorts: Port[];
  readonly outlets: ExhaustOutlet[] = [];
  /** Bypass flap joints of a valved exhaust. */
  private readonly valveJoints: ResistiveJoint[] = [];
  readonly turbines: TurbineStage[] = [];
  /** Collector junction per group (afterfire injection points). */
  readonly collectors: Junction[] = [];
  readonly groups: ExhaustGroup[];
  /** Pending injected mass-equivalent flow per collector (afterfire expansion, kg/s). */
  readonly collectorInjection: Float64Array;
  private readonly chain: ChainDuct[] = [];
  private readonly solvers: Array<(dt: number) => void> = [];
  private readonly joints: ResistiveJoint[] = [];
  private readonly groupOfCylinder: number[];
  private readonly egtByGroup: Float64Array;
  private readonly flowByGroup: Float64Array;
  private readonly rng: Rng;

  constructor(private readonly spec: EngineSpec, schedule: FiringSchedule, private readonly sampleRate: number, rng: Rng) {
    this.rng = rng;
    const ex = spec.exhaust;
    const turbo = spec.forcedInduction.kind === "turbo" ? spec.forcedInduction : null;
    const strategy = ex.routing === "open-headers" && ex.collector === "none" ? "none" : ex.collector;
    this.groups = exhaustGroups(schedule, strategy);
    this.groupOfCylinder = new Array(spec.cylinders).fill(0);
    this.groups.forEach((g, gi) => g.cylinders.forEach((c) => { this.groupOfCylinder[c - 1] = gi; }));
    this.egtByGroup = new Float64Array(this.groups.length).fill(900);
    this.flowByGroup = new Float64Array(this.groups.length).fill(0.02);
    this.collectorInjection = new Float64Array(this.groups.length);

    const primaryD = ex.primaryDiameterMm / 1000;
    this.primaries = Array.from({ length: spec.cylinders }, (_, i) => this.addDuct({
      lengthM: (ex.primaryLengthsMm[i] ?? ex.primaryLengthsMm[0] ?? 700) / 1000,
      diameterM: primaryD,
      steepening: true,
      name: `primary${i + 1}`,
    }, 0, this.groupOfCylinder[i]));
    this.primaryPorts = this.primaries.map((duct) => ({ duct, end: "a" as const }));

    const collectorD = ex.collectorDiameterMm / 1000;
    const pipeD = ex.pipeDiameterMm / 1000;

    // ---- Two-stroke: one pipe per cylinder (tuned expansion chamber or a plain pipe) to its silencer.
    if (spec.twoStroke) {
      this.primaries.forEach((header, i) => {
        let port: Port = { duct: header, end: "b" };
        let d = header.lengthM;
        const g = this.groupOfCylinder[i];
        if (spec.twoStroke!.expansionChamber) {
          // Blair-style proportions of the tuned length L_t (port → middle of the baffle cone), header
          // = 0.30·L_t: diffuser 0.40 to a belly 3.1× the header diameter, belly 0.12, baffle cone
          // 0.36 down to a stinger 0.62× the header, stinger 0.30. Cones as stepped segments. The
          // diffuser returns the blowdown pulse as a suction wave that pulls fresh charge through the
          // cylinder; the baffle returns a pressure wave that plugs the port before it closes.
          const lt = header.lengthM / 0.3;
          const belly = primaryD * 3.1;
          const stinger = primaryD * 0.62;
          const cone = (from: number, to: number, length: number, steps: number, name: string) => {
            for (let k = 0; k < steps; k++) {
              const t = (k + 0.5) / steps;
              const diameter = from * Math.pow(to / from, t);
              port = this.extend(port, { lengthM: length / steps, diameterM: diameter, name: `${name}${i}.${k}` }, d + length / steps / 2, g);
              d += length / steps;
            }
          };
          cone(primaryD, belly, 0.4 * lt, 4, "diffuser");
          port = this.extend(port, { lengthM: 0.12 * lt, diameterM: belly, name: `belly${i}` }, d + 0.06 * lt, g);
          d += 0.12 * lt;
          cone(belly, stinger, 0.36 * lt, 3, "baffle");
          port = this.extend(port, { lengthM: 0.3 * lt, diameterM: stinger, name: `stinger${i}` }, d + 0.15 * lt, g);
          d += 0.3 * lt;
        } else {
          port = this.extend(port, { lengthM: 0.6, diameterM: pipeD, name: `pipe${i}` }, d + 0.3, g);
          d += 0.6;
        }
        if (ex.muffler.type !== "none") {
          port = this.element(port, "muffler", ex.pipeDiameterMm / 1000, d, g);
          d += ex.muffler.bodyLengthMm / 1000;
        }
        const tail = this.extend(port, { lengthM: Math.max(0.05, ex.tailpipeLengthMm / 1000), diameterM: ex.tailpipeDiameterMm / 1000, name: `tail${i}` }, d + 0.1, g);
        const n = this.primaries.length;
        this.addOutlet(tail.duct, ex.tailpipeDiameterMm / 1000, { x: n === 1 ? 0.2 : (i / (n - 1) - 0.5) * 0.4, y: -1.0, z: 0.55 });
      });
      return;
    }

    // ---- Open primaries (zoomies / open stacks)
    if (strategy === "none") {
      this.groups.forEach((g, gi) => {
        const cyl = g.cylinders[0];
        const duct = this.primaries[cyl - 1];
        const side = this.sideOf(g.bank, gi);
        this.addOutlet(duct, primaryD, { x: side * 0.35, y: 1.1 - 0.1 * gi, z: 0.45 });
      });
      return;
    }

    // ---- Collectors
    const collectorOut: Port[] = [];
    this.groups.forEach((g, gi) => {
      const groupPrimaries = g.cylinders.map((c) => this.primaries[c - 1]);
      let inputs: Port[] = groupPrimaries.map((duct) => ({ duct, end: "b" as const }));
      if (g.pairs && g.pairs.length > 1) {
        // 4-2-1: pairs merge into secondaries first.
        inputs = g.pairs.map((pair, k) => {
          const secondary = this.addDuct({ lengthM: 0.38, diameterM: primaryD * 1.22, steepening: true, name: `secondary${gi}.${k}` }, 0.9, gi);
          this.addJunction([...pair.map((c) => ({ duct: this.primaries[c - 1], end: "b" as const })), { duct: secondary, end: "a" }]);
          return { duct: secondary, end: "b" as const };
        });
      }
      const merge = this.addDuct({ lengthM: 0.22, diameterM: collectorD, steepening: true, name: `collector${gi}` }, 1.0, gi);
      let collector: Junction;
      if (turbo) {
        collector = this.addJunction([...inputs, { duct: merge, end: "a" }], Math.max(0.3e-3, (spec.cylinders * 0.12e-3) / this.groups.length));
      } else {
        collector = this.addJunction([...inputs, { duct: merge, end: "a" }]);
      }
      this.collectors.push(collector);
      collectorOut.push({ duct: merge, end: "b" });
    });

    if (ex.routing === "open-headers") {
      collectorOut.forEach((port, gi) => {
        const side = this.sideOf(this.groups[gi].bank, gi);
        this.addOutlet(port.duct, collectorD, { x: side * 0.55, y: 0.6, z: 0.25 });
      });
      return;
    }

    // ---- Merge to the system layout: turbo(s), single or dual chains.
    let chainHeads: Port[] = collectorOut;
    if (turbo) {
      const turbines = Math.max(1, Math.min(turbo.count, chainHeads.length));
      const heads: Port[] = [];
      const perTurbine = Math.ceil(chainHeads.length / turbines);
      for (let t = 0; t < turbines; t++) {
        const feeds = chainHeads.slice(t * perTurbine, (t + 1) * perTurbine);
        const downpipe = this.addDuct({ lengthM: 0.55, diameterM: Math.max(pipeD, 0.06), name: `downpipe${t}` }, 1.6, t);
        // Solved by solveTurbine (with the nozzle outflow), not by the generic junction pass.
        const manifold = this.addJunction(feeds, 0.9e-3 + spec.cylinders * 0.05e-3, false);
        const stage: TurbineStage = {
          manifold,
          downpipe,
          // turbineAreaMm2 is the engine total; each stage carries its share of the turbos.
          turbineArea: (turbo.turbineAreaMm2 * 1e-6) / turbines,
          wastegate: 0,
          // Wastegate ports pass most of the flow at high speed: ~1.3 × the nozzle area.
          wastegateArea: (1.3 * turbo.turbineAreaMm2 * 1e-6) / turbines,
          massFlow: 0,
          wastegateMassFlow: 0,
          inletPa: P_AMBIENT,
          inletK: 900,
          outletPa: P_AMBIENT,
          areaFactor: 1,
          orifice: new ReservoirOrifice({ duct: downpipe, end: "a" }, this.sampleRate),
        };
        this.turbines.push(stage);
        this.solvers.push((dt) => this.solveTurbine(stage, dt));
        heads.push({ duct: downpipe, end: "b" });
      }
      chainHeads = heads;
    }

    const dual = ex.routing === "dual" && chainHeads.length >= 2;
    if (!dual && chainHeads.length > 1) {
      const y = this.addDuct({ lengthM: Math.max(0.2, ex.midPipeLengthMm / 1000), diameterM: pipeD * 1.15, name: "y-pipe" }, 1.6, 0);
      this.addJunction([...chainHeads, { duct: y, end: "a" }]);
      chainHeads = [{ duct: y, end: "b" }];
    } else if (dual && chainHeads.length > 2) {
      // three-bank W / radial collectors → two sides
      const left = chainHeads.filter((_, i) => i % 2 === 0);
      const right = chainHeads.filter((_, i) => i % 2 === 1);
      chainHeads = [left, right].map((side, si) => {
        const d = this.addDuct({ lengthM: 0.3, diameterM: pipeD, name: `merge-side${si}` }, 1.5, si);
        this.addJunction([...side, { duct: d, end: "a" }]);
        return { duct: d, end: "b" as const };
      });
    }

    // Mid pipes up to the crossover.
    let distance = 1.6;
    chainHeads = chainHeads.map((head, k) => this.extend(head, { lengthM: Math.max(0.15, ex.midPipeLengthMm / 1000), diameterM: pipeD, name: `mid${k}` }, distance + 0.3, k));
    distance += Math.max(0.15, ex.midPipeLengthMm / 1000);

    if (dual && ex.crossover !== "none" && chainHeads.length === 2) {
      if (ex.crossover === "x-pipe") {
        const outs = [0, 1].map((k) => this.addDuct({ lengthM: 0.2, diameterM: pipeD, name: `x-out${k}` }, distance + 0.1, k));
        this.addJunction([chainHeads[0], chainHeads[1], { duct: outs[0], end: "a" }, { duct: outs[1], end: "a" }]);
        chainHeads = outs.map((duct) => ({ duct, end: "b" as const }));
      } else {
        const balance = this.addDuct({ lengthM: 0.32, diameterM: pipeD * 0.85, name: "h-balance" }, distance, 0);
        const outs = [0, 1].map((k) => this.addDuct({ lengthM: 0.2, diameterM: pipeD, name: `h-out${k}` }, distance + 0.1, k));
        this.addJunction([chainHeads[0], { duct: balance, end: "a" }, { duct: outs[0], end: "a" }]);
        this.addJunction([chainHeads[1], { duct: balance, end: "b" }, { duct: outs[1], end: "a" }]);
        chainHeads = outs.map((duct) => ({ duct, end: "b" as const }));
      }
      distance += 0.2;
    }

    chainHeads.forEach((head, k) => {
      let port = head;
      let d = distance;
      if (ex.catalyst) {
        port = this.element(port, "catalyst", pipeD, d, k);
        d += 0.45;
      }
      port = this.extend(port, { lengthM: 0.45, diameterM: pipeD, name: `pipe-a${k}` }, d + 0.2, k);
      d += 0.45;
      if (ex.resonator) {
        port = this.element(port, "resonator", pipeD, d, k);
        d += 0.4;
      }
      port = this.extend(port, { lengthM: 0.6, diameterM: pipeD, name: `pipe-b${k}` }, d + 0.3, k);
      d += 0.6;
      // Side-branch silencers ahead of the muffler, tuned with c at tail-section gas temperature.
      const cTail = Math.sqrt(1.34 * R_AIR * 600);
      for (const hz of ex.quarterWaveTubesHz) {
        const side = this.addDuct({ lengthM: clamp(cTail / (4 * hz), 0.08, 3), diameterM: pipeD, name: `j-pipe${k}` }, d, k);
        port = this.branch(port, side, pipeD, d, k);
        d += 0.15;
      }
      for (const h of ex.helmholtz) {
        port = this.helmholtz(port, h.tuneHz, h.volumeL, pipeD, cTail, d, k);
        d += 0.15;
      }
      if (ex.muffler.type !== "none") {
        if (ex.valve) {
          // Valved exhaust: a bypass in parallel with the muffler, its flap a variable loss.
          const split = this.addDuct({ lengthM: 0.08, diameterM: pipeD, name: `valve-split${k}` }, d, k);
          const bypassIn = this.addDuct({ lengthM: ex.muffler.bodyLengthMm / 2000, diameterM: pipeD * 0.9, name: `bypass-a${k}` }, d, k);
          this.addJunction([port, { duct: split, end: "a" }, { duct: bypassIn, end: "a" }]);
          const mufOut = this.element({ duct: split, end: "b" }, "muffler", pipeD, d, k);
          const bypassOut = this.resistive({ duct: bypassIn, end: "b" }, { lengthM: ex.muffler.bodyLengthMm / 2000, diameterM: pipeD * 0.9, name: `bypass-b${k}` }, 4000, d, k);
          this.valveJoints.push(this.joints[this.joints.length - 1]);
          const merged = this.addDuct({ lengthM: 0.08, diameterM: pipeD, name: `valve-merge${k}` }, d + ex.muffler.bodyLengthMm / 1000, k);
          this.addJunction([mufOut, bypassOut, { duct: merged, end: "a" }]);
          port = { duct: merged, end: "b" };
        } else {
          port = this.element(port, "muffler", pipeD, d, k);
        }
        d += ex.muffler.bodyLengthMm / 1000;
      }
      const tail = this.extend(port, { lengthM: Math.max(0.1, ex.tailpipeLengthMm / 1000), diameterM: ex.tailpipeDiameterMm / 1000, name: `tail${k}` }, d + 0.2, k);
      const lateral = chainHeads.length === 1 ? 0.35 : (k === 0 ? -1 : 1) * ex.outletSpacingM / 2;
      this.addOutlet(tail.duct, ex.tailpipeDiameterMm / 1000, { x: lateral, y: -2.25, z: 0.3 });
    });
  }

  private sideOf(bank: number, groupIndex: number): number {
    return bank === 0 ? -1 : bank === 1 ? 1 : groupIndex % 2 === 0 ? -1 : 1;
  }

  private addDuct(opts: { lengthM: number; diameterM: number; steepening?: boolean; absorption?: number; name: string }, distanceM: number, group: number): Duct {
    const duct = new Duct(this.sampleRate, { ...opts, temperatureK: 800, gamma: 1.34 });
    this.chain.push({ duct, distanceM: distanceM + opts.lengthM / 2, group });
    return duct;
  }

  private addJunction(ports: Port[], volumeM3 = 0, autoSolve = true): Junction {
    const j = new Junction(ports, volumeM3, P_AMBIENT, 1.34);
    if (!autoSolve) return j;
    const index = this.collectors.length;
    const isCollector = ports.length >= 2;
    this.solvers.push((dt) => {
      const inj = isCollector && this.collectors[index] === j ? this.collectorInjection[index] : 0;
      j.solve(inj, dt);
    });
    return j;
  }

  /** Tee: continue the line with a new duct and attach `side` (its far end closed) at the junction. */
  private branch(from: Port, side: Duct, pipeD: number, distanceM: number, group: number): Port {
    const next = this.addDuct({ lengthM: 0.15, diameterM: pipeD, name: `after-${side.name}` }, distanceM, group);
    this.addJunction([from, { duct: next, end: "a" }, { duct: side, end: "a" }]);
    return { duct: next, end: "b" };
  }

  /**
   * Helmholtz resonator on a tee: neck (diameter 0.6 × pipe) into a cavity of `volumeL`, the neck
   * length chosen for f = (c/2π)·√(S/(V·L_eff)) with end corrections 1.7·r. Light neck absorption
   * stands in for the perforate/fibre damping that sets its bandwidth.
   */
  private helmholtz(from: Port, tuneHz: number, volumeL: number, pipeD: number, c: number, distanceM: number, group: number): Port {
    const r = 0.3 * pipeD;
    const S = Math.PI * r * r;
    const V = Math.max(0.1, volumeL) / 1000;
    const effective = (S * c * c) / (Math.pow(2 * Math.PI * tuneHz, 2) * V);
    const neck = this.addDuct({ lengthM: clamp(effective - 1.7 * r, 0.01, 1.5), diameterM: 2 * r, absorption: 6, name: `helmholtz-neck${group}` }, distanceM, group);
    const port = this.branch(from, neck, pipeD, distanceM, group);
    this.addJunction([{ duct: neck, end: "b" }], V);
    return port;
  }

  /** Exhaust valve flap position 0 (closed) … 1 (open), applied at block rate. */
  setValve(open: number): void {
    const o = clamp(open, 0, 1);
    // Butterfly loss: K ≈ 0.3 wide open, rising steeply as it closes (≈ 4000 shut, a leak-tight seal is not modelled).
    const k = 0.3 + 4000 * Math.pow(1 - o, 3);
    for (const j of this.valveJoints) j.lossCoefficient = k;
  }

  /** Append a duct after `from`, joined by an area-change junction. */
  private extend(from: Port, opts: { lengthM: number; diameterM: number; absorption?: number; name: string }, distanceM: number, group: number): Port {
    const duct = this.addDuct(opts, distanceM, group);
    this.addJunction([from, { duct, end: "a" }]);
    return { duct, end: "b" };
  }

  /** Series element joined through a mean-flow resistance. */
  private resistive(from: Port, opts: { lengthM: number; diameterM: number; absorption?: number; name: string }, k: number, distanceM: number, group: number, laminar?: ResistiveJoint["laminar"]): Port {
    // Short adaptor so the resistance sits between two ducts.
    const duct = this.addDuct(opts, distanceM, group);
    if (from.end !== "b") throw new Error("resistive element expects a downstream end");
    const joint = new ResistiveJoint(from.duct, duct, k);
    if (laminar) joint.laminar = laminar;
    this.joints.push(joint);
    this.solvers.push(() => joint.solve());
    return { duct, end: "b" };
  }

  private element(from: Port, kind: "catalyst" | "resonator" | "muffler", pipeD: number, distance: number, group: number): Port {
    const ex = this.spec.exhaust;
    if (kind === "catalyst") {
      // Monolith in a shell entered through conical diffusers (less reactive than a sudden
      // expansion: effective diameter ratio ≈ 1.5), entry/exit losses, and the laminar resistance of
      // ~400 cpsi channels (d_h ≈ 1.1 mm, 75 % open, 0.15 m brick). That lumped resistance carries
      // the channels' viscous loss (≈ 4 dB at 400 Hz); the shell keeps only light mat absorption.
      const shell = this.resistive(from, { lengthM: 0.3, diameterM: pipeD * 1.5, absorption: 6, name: `cat${group}` }, 1.4, distance, group, { lengthM: 0.15, hydraulicDiameterM: 1.1e-3, openArea: 0.75 });
      return this.extend(shell, { lengthM: 0.15, diameterM: pipeD, name: `cat-out${group}` }, distance + 0.38, group);
    }
    if (kind === "resonator") {
      // Straight-through perforated core in packing.
      return this.resistive(from, { lengthM: 0.38, diameterM: pipeD, absorption: 14, name: `resonator${group}` }, 0.15, distance, group);
    }
    const m = ex.muffler;
    const bodyD = m.bodyDiameterMm / 1000;
    const bodyL = m.bodyLengthMm / 1000;
    const packing = clamp(m.packing, 0, 1);
    switch (m.type) {
      case "glasspack":
        // Short perforated core in fibreglass: little low-frequency loss, strong high-frequency absorption.
        return this.resistive(from, { lengthM: bodyL * 0.7, diameterM: pipeD, absorption: 10 + 45 * packing, name: `glasspack${group}` }, 0.25, distance, group);
      case "straight-through":
        return this.resistive(from, { lengthM: bodyL, diameterM: pipeD, absorption: 6 + 34 * packing, name: `muffler${group}` }, 0.35, distance, group);
      case "chambered": {
        // Two reactive chambers joined by a short pass tube (Flowmaster-style chambered muffler).
        const c1 = this.resistive(from, { lengthM: bodyL * 0.45, diameterM: bodyD, absorption: 1 + 10 * packing, name: `chamber1-${group}` }, 1.2, distance, group);
        const tube = this.extend(c1, { lengthM: 0.09, diameterM: pipeD * 0.9, name: `pass-${group}` }, distance + bodyL * 0.5, group);
        const c2 = this.extend(tube, { lengthM: bodyL * 0.45, diameterM: bodyD, absorption: 1 + 10 * packing, name: `chamber2-${group}` }, distance + bodyL * 0.75, group);
        return c2;
      }
      case "turbo":
      default: {
        // OEM multi-chamber "turbo" box: reactive chambers with perforates into packing.
        const c1 = this.resistive(from, { lengthM: bodyL * 0.3, diameterM: bodyD, absorption: 4 + 26 * packing, name: `box1-${group}` }, 2.2, distance, group);
        const t1 = this.extend(c1, { lengthM: 0.12, diameterM: pipeD * 0.85, absorption: 8, name: `perf1-${group}` }, distance + bodyL * 0.35, group);
        const c2 = this.extend(t1, { lengthM: bodyL * 0.3, diameterM: bodyD, absorption: 4 + 26 * packing, name: `box2-${group}` }, distance + bodyL * 0.55, group);
        const t2 = this.extend(c2, { lengthM: 0.12, diameterM: pipeD * 0.85, absorption: 8, name: `perf2-${group}` }, distance + bodyL * 0.75, group);
        return this.extend(t2, { lengthM: bodyL * 0.25, diameterM: bodyD * 0.8, absorption: 4 + 26 * packing, name: `box3-${group}` }, distance + bodyL * 0.9, group);
      }
    }
  }

  private addOutlet(duct: Duct, diameter: number, position: Vec3): void {
    const load = new RadiationLoad(this.sampleRate, diameter / 2, duct.c);
    const outlet: ExhaustOutlet = {
      duct,
      load,
      position,
      jet: new BandNoise(this.rng, this.sampleRate, 0.55),
      meanQ: 0,
      volumeAcceleration: 0,
      diameter,
    };
    this.outlets.push(outlet);
    let tick = 0;
    this.solvers.push(() => {
      if ((tick++ & 15) === 0) load.setSpeedOfSound(duct.c);
      const reflected = load.process(duct.arrivingB, duct.Z);
      send({ duct, end: "b" }, reflected);
      outlet.volumeAcceleration = load.volumeAcceleration;
    });
  }

  /**
   * Turbine (+ wastegate) as a nozzle from the manifold volume into the downpipe, solved implicitly
   * against the downpipe impedance; the manifold integrates the net flow with the nozzle's
   * linearised conductance so the pair stays stable at any area.
   */
  private solveTurbine(stage: TurbineStage, dt: number): void {
    const pMan = P_AMBIENT + stage.manifold.pressure;
    const down = stage.downpipe;
    const area = 0.85 * (stage.turbineArea * stage.areaFactor + stage.wastegateArea * clamp(stage.wastegate, 0, 1));
    const T = stage.inletK;
    stage.orifice.solve(area, pMan, T, orificeMassFlow, P_AMBIENT);
    const mdot = stage.orifice.massFlow;
    const pDown = P_AMBIENT + down.arrivingA + down.sendA;
    // Conductance of the nozzle seen from the manifold: subsonic ≈ ṁ/(2Δp), choked ≈ ṁ/p.
    const dpAcross = Math.max(200, pMan - pDown);
    const conductance = pMan / Math.max(1, pDown) > 1.85 ? mdot / pMan : mdot / (2 * dpAcross);
        stage.manifold.meanPressurePa = pMan;
    stage.manifold.nodeSoundSpeed = Math.sqrt(1.34 * R_AIR * T);
    stage.manifold.solve(-mdot, dt, -conductance);
    stage.massFlow = mdot;
    const wgShare = area > 0 ? (0.85 * stage.wastegateArea * clamp(stage.wastegate, 0, 1)) / area : 0;
    stage.wastegateMassFlow = mdot * wgShare;
    stage.inletPa = pMan;
    stage.outletPa = pDown;
  }

  /** Solve every non-valve boundary for this sample (ducts' beginSample must already have run). */
  step(dt: number): void {
    for (let i = 0; i < this.solvers.length; i++) this.solvers[i](dt);
    this.collectorInjection.fill(0);
  }

  /** Record exhaust flow from a cylinder (for temperatures and jet noise). */
  noteCylinderFlow(cylinderIndex: number, massFlow: number, gasTempK: number): void {
    if (massFlow <= 0) return;
    const g = this.groupOfCylinder[cylinderIndex];
    const w = massFlow * 2e-3;
    this.egtByGroup[g] += (gasTempK - this.egtByGroup[g]) * Math.min(1, w);
    this.flowByGroup[g] += massFlow;
  }

  groupOf(cylinderIndex: number): number {
    return this.groupOfCylinder[cylinderIndex];
  }

  /** Block-rate update: duct temperatures, mean-flow resistances, outlet jet means. */
  updateBlock(blockSeconds: number, totalExhaustMassFlow: number, turboInletK?: number): void {
    const groups = this.groups.length;
    for (let g = 0; g < groups; g++) {
      // flowByGroup accumulated kg/s per sample → average over block
      this.flowByGroup[g] = this.flowByGroup[g] / Math.max(1, blockSeconds * this.sampleRate);
    }
    const perGroupFlow = totalExhaustMassFlow / Math.max(1, this.outlets.length || 1);
    for (const item of this.chain) {
      const g = Math.min(item.group, groups - 1);
      const flow = Math.max(0.002, this.flowByGroup[Math.max(0, g)] || totalExhaustMassFlow / groups);
      // Cooling length grows with mass flow (convective film coefficient ∝ ṁ^0.8, Dittus–Boelter).
      const coolingLength = clamp(1.2 + 34 * Math.pow(flow, 0.8), 1.2, 9);
      const egt = Math.max(T_AMBIENT + 50, this.egtByGroup[Math.max(0, g)] * 0.82);
      const T = T_AMBIENT + (egt - T_AMBIENT) * Math.exp(-item.distanceM / coolingLength);
      // Mean pressure follows the duct's own static pressure (backpressure, turbo manifold) so the
      // mass ↔ volume conversion at every boundary uses the true gas density.
      const meanPa = Math.max(0.3 * P_AMBIENT, P_AMBIENT + item.duct.staticGauge);
      if (Math.abs(T - item.duct.temperatureK) > 2 || Math.abs(meanPa - item.duct.meanPressurePa) > 300) item.duct.setTemperature(T, meanPa);
    }
    for (const joint of this.joints) joint.updateResistance(perGroupFlow);
    for (const t of this.turbines) t.inletK = turboInletK ?? Math.max(...Array.from(this.egtByGroup));
    this.flowByGroup.fill(0);
  }

  ducts(): Duct[] {
    return this.chain.map((c) => c.duct);
  }

  /** Mean exhaust gas temperature at the ports, K. */
  get portTemperatureK(): number {
    let s = 0;
    for (const t of this.egtByGroup) s += t;
    return s / this.egtByGroup.length;
  }

  /** Jet noise at each outlet: Lighthill U⁸ power, Strouhal 0.2 centre, pulse-synchronous modulation. */
  outletJetNoise(outlet: ExhaustOutlet): number {
    const area = Math.PI * outlet.diameter * outlet.diameter * 0.25;
    const q = outlet.load.volumeVelocity;
    outlet.meanQ += (q - outlet.meanQ) * 0.0005;
    const uMean = Math.max(0.5, Math.abs(outlet.meanQ) / area);
    const uInst = clamp(Math.abs(q) / area, 0, Math.min(4.5 * uMean, 0.9 * outlet.duct.c));
    outlet.jet.setCentre((0.2 * Math.max(uMean, 5)) / outlet.diameter);
    const c = outlet.duct.c;
    const rho = outlet.duct.rho;
    // W = K ρ A U^8 / c^5 ; monopole equivalent (dQ/dt)_rms = sqrt(4π c_air W / ρ_air).
    const K = 1e-4 * 60;
    const W = (K * rho * area * Math.pow(uInst, 8)) / Math.pow(c, 5);
    const qdotRms = Math.sqrt((4 * Math.PI * C_AIR * W) / RHO_AIR);
    return outlet.jet.next() * qdotRms;
  }
}

export const exhaustAmbientDensity = P_AMBIENT / (R_AIR * T_AMBIENT);
