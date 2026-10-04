/**
 * Induction system: per-cylinder runners into a plenum fed through a throttle
 * from an airbox (or a boost charge volume), the airbox breathing through an
 * air filter and snorkel that radiates to the engine bay. Individual throttle
 * bodies and velocity stacks replace plenum + throttle with an orifice at each
 * runner mouth, which then radiates directly.
 *
 * Intake noise is whatever the valve events push back up these ducts, filtered
 * by runner/plenum (Helmholtz) and airbox resonances and the filter element —
 * plus throttle-plate turbulence at part throttle.
 */
import type { EngineSpec } from "./spec";
import { BandNoise, C_AIR, P_AMBIENT, R_AIR, RHO_AIR, Rng, T_AMBIENT, clamp, orificeMassFlow } from "./gas";
import { Duct, Junction, RadiationLoad, ReservoirOrifice, ResistiveJoint, arriving, send } from "./waveguide";
import type { Port } from "./waveguide";

export interface IntakeSource {
  /** Monopole volume acceleration (m³/s²) radiated into the engine bay. */
  volumeAcceleration: number;
}

export class IntakeSystem {
  readonly runners: Duct[];
  readonly runnerPorts: Port[];
  readonly hasPlenum: boolean;
  private readonly plenum?: Junction;
  private readonly airbox?: Junction;
  private readonly snorkel?: Duct;
  private readonly filterDuct?: Duct;
  private readonly filterJoint?: ResistiveJoint;
  private readonly mouth?: RadiationLoad;
  // Snorkel resonator: tee between the mouth-side snorkel and the inner snorkel, neck and cavity.
  private readonly snorkelInner?: Duct;
  private readonly resonatorNeck?: Duct;
  private readonly resonatorTee?: Junction;
  private readonly resonatorCavity?: Junction;
  private readonly stacks: ReservoirOrifice[] = [];
  /** Wankel: one runner per rotor, fed by its three faces' port passages through a junction. */
  private readonly rotorRunners: Duct[] = [];
  private readonly rotorPorts: Junction[] = [];
  private readonly throttleNoise: BandNoise;
  private readonly throttleDiameter: number;
  private bypassMax: number;
  /** Air temperature in the runners, K. */
  airTempK = T_AMBIENT + 15;
  /** Absolute manifold pressure, Pa. */
  mapPa = P_AMBIENT;
  throttleMassFlow = 0;
  /** Reservoir feeding the throttle(s): ambient, or the boost charge volume. */
  upstreamPa = P_AMBIENT;
  upstreamK = T_AMBIENT;
  /** Boosted engines: the throttle draws from the charge volume and the airbox feeds the compressor. */
  readonly boosted: boolean;
  /** Mass flow the compressor pulls from the airbox (kg/s), set by the forced-induction model. */
  compressorDraw = 0;
  /** Volume acceleration at the intake mouth(s), for the observer. */
  mouthVolumeAcceleration = 0;
  /** Throttle turbulence volume acceleration (radiated through the airbox path). */
  private smoothFlow = 0;
  private flowFilterState = 0;

  constructor(spec: EngineSpec, private readonly sampleRate: number, rng: Rng) {
    const n = spec.cylinders;
    const it = spec.intake;
    this.throttleDiameter = it.throttleDiameterMm / 1000;
    this.bypassMax = it.idleBypassAreaMm2 * 1e-6;
    this.throttleNoise = new BandNoise(rng, sampleRate, 0.6);
    this.runners = Array.from({ length: n }, (_, i) => new Duct(sampleRate, {
      lengthM: spec.rotary ? 0.04 : it.runnerLengthMm / 1000,
      diameterM: it.runnerDiameterMm / 1000,
      temperatureK: this.airTempK,
      gamma: 1.4,
      name: `runner${i + 1}`,
    }));
    this.runnerPorts = this.runners.map((duct) => ({ duct, end: "b" as const }));
    this.hasPlenum = it.type !== "itbs" && it.type !== "velocity-stacks";
    this.boosted = spec.forcedInduction.kind !== "na";

    // Wankel: the three faces of a rotor share its intake port. Each face's "runner" is then a short
    // port passage, and the rotor's runner joins them to the plenum.
    let upstream = this.runners;
    if (spec.rotary) {
      const rotors = spec.rotary.rotors;
      this.rotorRunners = Array.from({ length: rotors }, (_, k) => new Duct(sampleRate, {
        lengthM: it.runnerLengthMm / 1000,
        diameterM: it.runnerDiameterMm / 1000,
        temperatureK: this.airTempK,
        gamma: 1.4,
        name: `rotor-runner${k + 1}`,
      }));
      this.rotorPorts = this.rotorRunners.map((rotorDuct, k) => new Junction(
        [...this.runners.slice(k * 3, k * 3 + 3).map((duct) => ({ duct, end: "a" as const })), { duct: rotorDuct, end: "b" as const }],
        0, P_AMBIENT, 1.4,
      ));
      upstream = this.rotorRunners;
    }

    if (this.hasPlenum) {
      this.plenum = new Junction(upstream.map((duct) => ({ duct, end: "a" as const })), Math.max(0.2, it.plenumVolumeL) / 1000, P_AMBIENT, 1.4);
      // Radiused runner entries (K ≈ 0.08); reversion jets into the plenum lose their head (K ≈ 0.9).
      this.plenum.setPortLoss(0.08, 0.9);
    } else {
      this.stacks = upstream.map((duct) => new ReservoirOrifice({ duct, end: "a" }, sampleRate));
    }

    // Airbox → filter element → snorkel → mouth. Carbs and ITBs with open filters keep a small volume.
    // Filter media absorption, dB/m at 1 kHz over the element depth (pleated paper in a box ≫ open cone).
    const filterAbsorption = it.filter === "oem-paper" ? 160 : it.filter === "cone" ? 60 : it.filter === "sock" ? 35 : 0;
    if (this.hasPlenum || it.airboxVolumeL > 0.3) {
      this.filterDuct = new Duct(sampleRate, { lengthM: 0.06, diameterM: Math.max(0.06, it.snorkelDiameterMm / 1000 * 1.6), temperatureK: T_AMBIENT, gamma: 1.4, absorption: filterAbsorption, name: "filter" });
      this.snorkel = new Duct(sampleRate, { lengthM: Math.max(0.03, it.snorkelLengthMm / 1000), diameterM: it.snorkelDiameterMm / 1000, temperatureK: T_AMBIENT, gamma: 1.4, absorption: 2, name: "snorkel" });
      // Loss coefficients referred to snorkel velocity: OEM panel element + box ≈ 1.2, cone ≈ 0.5, sock ≈ 0.4.
      let filterUpstream = this.snorkel;
      if (it.resonatorHz > 0) {
        // Helmholtz resonator teed into the snorkel: neck 0.5 × snorkel diameter, length for
        // f = (c/2π)·√(S/(V·L_eff)) with end corrections 1.7·r.
        const sd = it.snorkelDiameterMm / 1000;
        this.snorkelInner = new Duct(sampleRate, { lengthM: 0.12, diameterM: sd, temperatureK: T_AMBIENT, gamma: 1.4, absorption: 2, name: "snorkel-inner" });
        const r = 0.25 * sd;
        const S = Math.PI * r * r;
        const V = it.resonatorVolumeL / 1000;
        const effective = (S * C_AIR * C_AIR) / (Math.pow(2 * Math.PI * it.resonatorHz, 2) * V);
        this.resonatorNeck = new Duct(sampleRate, { lengthM: clamp(effective - 1.7 * r, 0.01, 0.6), diameterM: 2 * r, temperatureK: T_AMBIENT, gamma: 1.4, absorption: 4, name: "resonator-neck" });
        this.resonatorTee = new Junction([{ duct: this.snorkel, end: "b" }, { duct: this.snorkelInner, end: "a" }, { duct: this.resonatorNeck, end: "a" }], 0, P_AMBIENT, 1.4);
        this.resonatorCavity = new Junction([{ duct: this.resonatorNeck, end: "b" }], V, P_AMBIENT, 1.4);
        filterUpstream = this.snorkelInner;
      }
      this.filterJoint = new ResistiveJoint(filterUpstream, this.filterDuct, it.filter === "none" ? 0.05 : it.filter === "oem-paper" ? 1.2 : it.filter === "cone" ? 0.5 : 0.4);
      const airboxPorts: Port[] = [{ duct: this.filterDuct, end: "b" }];
      this.airbox = new Junction(airboxPorts, Math.max(0.4, it.airboxVolumeL) / 1000, P_AMBIENT, 1.4);
      this.mouth = new RadiationLoad(sampleRate, it.snorkelDiameterMm / 2000, 346);
      this.mouth.nonlinearLoss = 0.4;
    }
  }

  /** Scale the idle-air valve's authority (large-overlap cams need more idle air). */
  setBypassScale(scale: number): void {
    this.bypassMax *= scale;
  }

  /** Geometric throttle plate open area for pedal 0..1 (butterfly: A = A0·(1 − cos φ / cos φ0)). */
  /** Full idle-air bypass area, m². */
  get bypassMaxArea(): number {
    return this.bypassMax;
  }

  throttleArea(throttle: number, bypass: number): number {
    return this.plateArea(throttle, this.throttleDiameter) + this.bypassMax * clamp(bypass, 0, 1) + 2e-6;
  }

  private plateArea(throttle: number, diameter: number): number {
    const phi0 = (6 * Math.PI) / 180;
    const phi = phi0 + (Math.PI / 2 - phi0) * clamp(throttle, 0, 1);
    const a0 = (Math.PI / 4) * diameter * diameter;
    return Math.max(0, a0 * (1 - Math.cos(phi) / Math.cos(phi0)));
  }

  /**
   * Solve all intake boundaries except the valve ends (the cylinders own those).
   * @param throttle 0..1 plate opening (after the ECU's pedal map)
   * @param bypass 0..1 idle-air-control opening
   */
  step(throttle: number, bypass: number, dt: number): void {
    for (const j of this.rotorPorts) j.solve(0, dt);
    // Discharge coefficient rises from ~0.7 (sharp-edged gap) to ~0.86 with the plate edge-on.
    const cdA = (0.7 + 0.16 * clamp(throttle, 0, 1)) * this.throttleArea(throttle, bypass);
    if (this.plenum) {
      const pPlenumAbs = P_AMBIENT + this.plenum.pressure;
      const upstreamAbs = this.boosted ? this.upstreamPa : this.airbox ? P_AMBIENT + this.airbox.pressure : P_AMBIENT;
      const upstreamK = this.upstreamK;
      const mdot = orificeMassFlow(cdA, upstreamAbs, upstreamK, pPlenumAbs, this.airTempK);
      const dp = 25;
      const dmdp = (orificeMassFlow(cdA, upstreamAbs, upstreamK, pPlenumAbs + dp, this.airTempK) - mdot) / dp;
      const rhoPlenum = pPlenumAbs / (R_AIR * this.airTempK);
      // Throttle-plate turbulence: dipole sources at the plate edge, strongest at small openings
      // where the jet is fast (choked at idle). Velocity from the orifice flow, Strouhal 0.2.
      const throatArea = Math.max(1e-6, cdA);
      const u = Math.min(340, Math.abs(mdot) / (rhoPlenum * throatArea));
      const gap = Math.max(0.002, Math.sqrt(throatArea));
      this.throttleNoise.setCentre((0.2 * u) / gap);
      const mach = u / 340;
      const turbulenceQ = this.throttleNoise.next() * (Math.abs(mdot) / rhoPlenum) * 0.015 * mach * mach;
      this.plenum.meanPressurePa = pPlenumAbs;
      this.plenum.nodeSoundSpeed = Math.sqrt(1.4 * R_AIR * this.airTempK);
      this.plenum.solve(mdot + turbulenceQ * rhoPlenum, dt, dmdp);
      this.throttleMassFlow = mdot;
      this.mapPa = P_AMBIENT + this.plenum.pressure;
      if (this.airbox) {
        this.airbox.meanPressurePa = P_AMBIENT + this.airbox.pressure;
        this.airbox.solve(-(this.boosted ? this.compressorDraw : mdot), dt, 0);
      }
    } else {
      // ITBs / velocity stacks: each runner mouth is its own throttle (plate ≈ runner bore) and
      // radiator; the idle-air bypass and plate leakage are shared across the stacks.
      // ITB bores run ~10 % over the runner; wide open the stack is a bellmouth (Cd ≈ 0.95).
      const n = Math.max(1, this.stacks.length);
      const itbArea = this.plateArea(throttle, 2.2 * (this.rotorRunners[0] ?? this.runners[0]).radius) + (this.bypassMax * clamp(bypass, 0, 1) + 2e-6) / n;
      const perRunner = (0.7 + 0.25 * clamp(throttle, 0, 1)) * itbArea;
      const reservoir = this.boosted ? this.upstreamPa : this.airbox ? P_AMBIENT + this.airbox.pressure : P_AMBIENT;
      let acc = 0;
      let total = 0;
      let mapSum = 0;
      for (const stack of this.stacks) {
        stack.solve(perRunner, reservoir, this.upstreamK, orificeMassFlow, P_AMBIENT);
        acc += stack.volumeAcceleration;
        total += stack.massFlow;
        mapSum += P_AMBIENT + 2 * stack.port.duct.arrivingA;
      }
      this.throttleMassFlow = total;
      this.mapPa = mapSum / this.stacks.length;
      this.mouthVolumeAcceleration = acc;
      if (this.airbox) this.airbox.solve(-(this.boosted ? this.compressorDraw : total), dt, 0);
    }

    if (this.snorkel && this.filterJoint && this.mouth) {
      if (this.resonatorTee && this.resonatorCavity) {
        this.resonatorTee.solve(0, dt);
        this.resonatorCavity.solve(0, dt);
      }
      this.filterJoint.solve();
      const reflected = this.mouth.process(this.snorkel.arrivingA, this.snorkel.Z);
      send({ duct: this.snorkel, end: "a" }, reflected);
      this.mouthVolumeAcceleration = -this.mouth.volumeAcceleration;
    }
  }

  /** Block-rate housekeeping: duct gas state follows manifold pressure and charge temperature. */
  updateBlock(): void {
    for (const r of this.runners) r.setTemperature(this.airTempK, Math.max(0.05 * P_AMBIENT, P_AMBIENT + r.staticGauge));
    for (const r of this.rotorRunners) r.setTemperature(this.airTempK, Math.max(0.05 * P_AMBIENT, P_AMBIENT + r.staticGauge));
    this.flowFilterState = this.flowFilterState * 0.9 + this.throttleMassFlow * 0.1;
    this.smoothFlow = this.flowFilterState;
    if (this.filterJoint) this.filterJoint.updateResistance(this.smoothFlow);
  }

  ducts(): Duct[] {
    const list = [...this.runners, ...this.rotorRunners];
    if (this.filterDuct) list.push(this.filterDuct);
    if (this.snorkel) list.push(this.snorkel);
    if (this.snorkelInner) list.push(this.snorkelInner);
    if (this.resonatorNeck) list.push(this.resonatorNeck);
    return list;
  }

  /** Initial plenum state (gauge Pa). */
  initialise(mapPa: number): void {
    if (this.plenum) {
      this.plenum.pressure = mapPa - P_AMBIENT;
      this.mapPa = mapPa;
    }
    for (const r of [...this.runners, ...this.rotorRunners]) r.setTemperature(this.airTempK, this.hasPlenum ? mapPa : P_AMBIENT);
  }

  /** Compressor inlet (airbox) absolute pressure. */
  get compressorInletPa(): number {
    return this.airbox ? P_AMBIENT + this.airbox.pressure : P_AMBIENT;
  }

  get plenumJunction(): Junction | undefined {
    return this.plenum;
  }

  /** Pressure at a runner's plenum end, for diagnostics. */
  runnerEndPressure(i: number): number {
    return 2 * arriving({ duct: this.runners[i], end: "a" });
  }
}
