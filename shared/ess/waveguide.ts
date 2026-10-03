/**
 * Plane-wave duct acoustics: bidirectional fractional delay lines with
 * visco-thermal loss and finite-amplitude steepening, N-port scattering
 * junctions, compliant volume junctions and an unflanged-pipe radiation load.
 *
 * Conventions: pressures are gauge (Pa relative to ambient). Each duct end
 * exposes the wave arriving at that end (`arrivingA/B`) and accepts the wave
 * leaving that end (`sendA/B`). A junction sees, for each attached port, the
 * arriving pressure wave and the port admittance Y = A/(ρc); it returns the
 * outgoing wave so pressure is continuous and volume velocity is conserved.
 *
 * Steepening follows the simple-wave relation dx/dt = c + β·u with
 * β = (γ+1)/2, implemented as an amplitude-dependent read delay
 * (Hirschberg et al., JASA 1996; Msallam et al., Acta Acustica 2000; the same
 * approach as EngineLab's NonlinearDuctAcoustics).
 */
import { GAMMA_GAS, R_AIR, speedOfSound, P_AMBIENT } from "./gas";

const BETA_NL = (GAMMA_GAS + 1) / 2;

export class DelayLine {
  readonly buf: Float64Array;
  private readonly mask: number;
  private w = 0;

  constructor(maxDelaySamples: number) {
    let size = 8;
    while (size < maxDelaySamples + 8) size <<= 1;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
  }

  write(x: number): void {
    this.w = (this.w + 1) & this.mask;
    this.buf[this.w] = x;
  }

  /** Cubic Hermite read `d` samples behind the most recent write (d ≥ 1). */
  read(d: number): number {
    const pos = this.w - d;
    const i = Math.floor(pos);
    const f = pos - i;
    const m = this.mask;
    const xm1 = this.buf[(i - 1) & m];
    const x0 = this.buf[i & m];
    const x1 = this.buf[(i + 1) & m];
    const x2 = this.buf[(i + 2) & m];
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  /** Linear-interpolated read (used for the second, amplitude-corrected steepening read). */
  readLinear(d: number): number {
    const pos = this.w - d;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[i & this.mask];
    return a + (this.buf[(i + 1) & this.mask] - a) * f;
  }

  get capacity(): number {
    return this.buf.length - 8;
  }
}

export interface DuctOptions {
  lengthM: number;
  diameterM: number;
  temperatureK: number;
  meanPressurePa?: number;
  /**
   * Lined-duct absorption (perforated core into packing, catalyst monolith), dB per metre at 1 kHz,
   * rising ~f^0.7. 0 = plain pipe (visco-thermal losses only).
   */
  absorption?: number;
  /** Enable finite-amplitude steepening (long, high-amplitude exhaust ducts). */
  steepening?: boolean;
  /** Ratio of specific heats of the duct gas (air 1.4, exhaust ≈1.34). */
  gamma?: number;
  name?: string;
}

/**
 * A uniform duct. `a` is the upstream end, `b` the downstream end.
 * Per sample: read `arrivingA/B` (after `beginSample`), compute junctions,
 * then `endSample(sendA, sendB)`.
 */
export class Duct {
  readonly area: number;
  readonly radius: number;
  lengthM: number;
  temperatureK: number;
  meanPressurePa: number;
  c: number;
  rho: number;
  /** Admittance A/(ρc), m³/(s·Pa). */
  Y: number;
  delaySamples: number;
  /** Delay the line glides toward (temperature changes become smooth Doppler shifts, not steps). */
  private targetDelay = 1.5;
  private targetLossCoeff = 0;
  private targetC = 343;
  private targetRho = 1.2;
  private targetLossGain = 1;
  arrivingA = 0;
  arrivingB = 0;
  /** Waves to inject at each end this sample; set by whatever boundary owns that end. */
  sendA = 0;
  sendB = 0;
  readonly name: string;
  private readonly fwd: DelayLine;
  private readonly bwd: DelayLine;
  private lossA = 0;
  private lossB = 0;
  /** Slow mean of each travelling wave: static pressure passes losslessly (losses ∝ √f vanish at DC). */
  private dcA = 0;
  private dcB = 0;
  private readonly dcCoeff: number;
  private lossCoeff = 0;
  private lossGain = 1;
  private readonly steepening: boolean;
  private readonly absorption: number;
  readonly gamma: number;

  constructor(private readonly sampleRate: number, opts: DuctOptions) {
    this.lengthM = Math.max(0.005, opts.lengthM);
    this.radius = Math.max(0.004, opts.diameterM / 2);
    this.area = Math.PI * this.radius * this.radius;
    this.temperatureK = opts.temperatureK;
    this.meanPressurePa = opts.meanPressurePa ?? P_AMBIENT;
    this.steepening = !!opts.steepening;
    this.name = opts.name ?? "duct";
    this.absorption = Math.max(0, opts.absorption ?? 0);
    this.dcCoeff = (2 * Math.PI * 4) / sampleRate;
    this.gamma = opts.gamma ?? GAMMA_GAS;
    const cMin = speedOfSound(Math.min(opts.temperatureK, 250), this.gamma);
    const maxDelay = (this.lengthM / cMin) * sampleRate * 1.4 + 8;
    this.fwd = new DelayLine(maxDelay);
    this.bwd = new DelayLine(maxDelay);
    this.c = 0;
    this.rho = 0;
    this.Y = 0;
    this.delaySamples = 1;
    this.setTemperature(opts.temperatureK, this.meanPressurePa);
  }

  /** Update gas state (call at block rate). Delay changes are smooth: the read position glides. */
  setTemperature(temperatureK: number, meanPressurePa = this.meanPressurePa): void {
    this.temperatureK = temperatureK;
    this.meanPressurePa = meanPressurePa;
    const c = speedOfSound(temperatureK, this.gamma);
    const rho = meanPressurePa / (R_AIR * temperatureK);
    this.targetC = c;
    this.targetRho = rho;
    if (!this.initialised) {
      this.c = c;
      this.rho = rho;
      this.Y = this.area / (rho * c);
    }
    const maxD = this.fwd.capacity - 4;
    const transit = (this.lengthM / c) * this.sampleRate;
    // Visco-thermal boundary-layer attenuation α(f) = (1/(r c))·sqrt(π f ν)·(1 + (γ-1)/√Pr),
    // ν from Sutherland-like scaling of air viscosity with temperature.
    const nu = 1.5e-5 * Math.pow(temperatureK / 293, 1.7) * (P_AMBIENT / meanPressurePa);
    const lined = this.absorption * 0.1151; // dB → Np
    const alphaAt = (f: number) => (Math.sqrt(Math.PI * f * nu) / (this.radius * c)) * 1.45 + lined * Math.pow(f / 1000, 0.7);
    // Fit a one-pole low-pass + gain to the transit loss at 250 Hz and 4 kHz.
    const lossLo = Math.exp(-alphaAt(250) * this.lengthM);
    const lossHi = Math.exp(-alphaAt(4000) * this.lengthM);
    const lossGain = Math.min(1, lossLo);
    const ratio = Math.min(0.9999, Math.max(1e-4, lossHi / lossLo));
    // one-pole |H(f)| = 1/sqrt(1+(f/fc)^2) → fc = 4000/sqrt(1/ratio^2 - 1)
    const fc = ratio >= 0.9999 ? this.sampleRate * 0.45 : Math.min(this.sampleRate * 0.45, 4000 / Math.sqrt(1 / (ratio * ratio) - 1));
    const lossCoeff = Math.exp((-2 * Math.PI * fc) / this.sampleRate);
    // The loss low-pass adds k/(1-k) samples of low-frequency group delay; take it out of the line.
    const filterDelay = lossCoeff / (1 - lossCoeff);
    this.targetDelay = Math.min(maxD, Math.max(1.5, transit - Math.min(filterDelay, transit * 0.5)));
    this.targetLossCoeff = lossCoeff;
    this.targetLossGain = lossGain;
    if (!this.initialised) {
      this.delaySamples = this.targetDelay;
      this.lossCoeff = lossCoeff;
      this.lossGain = lossGain;
      this.initialised = true;
    }
  }

  private initialised = false;

  /** Static (mean) gauge pressure in the duct: sum of the slow parts of both travelling waves. */
  get staticGauge(): number {
    return this.dcA + this.dcB;
  }

  /** Characteristic impedance ρc/A. */
  get Z(): number {
    return 1 / this.Y;
  }

  beginSample(): void {
    // Gas state glides (≈10 ms) so impedance and delay never step: a step in ρc/A under mean flow
    // is a pressure step at every junction, i.e. broadband clicks.
    const g = 0.002;
    this.delaySamples += (this.targetDelay - this.delaySamples) * g;
    this.c += (this.targetC - this.c) * g;
    this.rho += (this.targetRho - this.rho) * g;
    this.Y = this.area / (this.rho * this.c);
    this.lossCoeff += (this.targetLossCoeff - this.lossCoeff) * 0.002;
    this.lossGain += (this.targetLossGain - this.lossGain) * 0.002;
    let rawB = this.fwd.read(this.delaySamples);
    let rawA = this.bwd.read(this.delaySamples);
    if (this.steepening) {
      const stiffness = this.rho * this.c * this.c;
      rawB = this.fwd.readLinear(this.steepenedDelay(rawB - this.dcB, stiffness));
      rawA = this.bwd.readLinear(this.steepenedDelay(rawA - this.dcA, stiffness));
    }
    const k = this.lossCoeff;
    this.lossB = rawB + k * (this.lossB - rawB);
    this.lossA = rawA + k * (this.lossA - rawA);
    this.dcB += (this.lossB - this.dcB) * this.dcCoeff;
    this.dcA += (this.lossA - this.dcA) * this.dcCoeff;
    this.arrivingB = this.dcB + (this.lossB - this.dcB) * this.lossGain;
    this.arrivingA = this.dcA + (this.lossA - this.dcA) * this.lossGain;
    this.sendA = this.arrivingA;
    this.sendB = this.arrivingB;
  }

  private steepenedDelay(p: number, stiffness: number): number {
    let mach = (BETA_NL * p) / stiffness;
    if (mach > 0.3) mach = 0.3;
    else if (mach < -0.3) mach = -0.3;
    return Math.max(1.5, Math.min(this.fwd.capacity - 4, this.delaySamples / (1 + mach)));
  }

  /** Inject the waves leaving end a (travelling downstream) and end b (travelling upstream). */
  endSample(sendA: number, sendB: number): void {
    this.fwd.write(sendA);
    this.bwd.write(sendB);
  }

  /** Commit `sendA`/`sendB`. Ends nobody drives default to a rigid (reflecting) termination. */
  commit(): void {
    this.fwd.write(this.sendA);
    this.bwd.write(this.sendB);
  }
}

/** A reference to one end of a duct. */
export interface Port {
  duct: Duct;
  end: "a" | "b";
}

export function arriving(port: Port): number {
  return port.end === "a" ? port.duct.arrivingA : port.duct.arrivingB;
}

export function send(port: Port, wave: number): void {
  if (port.end === "a") port.duct.sendA = wave;
  else port.duct.sendB = wave;
}

/** Volume velocity leaving the duct through this end (m³/s), after the end's send is set. */
export function outflow(port: Port): number {
  const d = port.duct;
  // +x volume velocity q = (p+ − p−)/Z ; at end a p+ = send, p− = arriving; at end b p+ = arriving, p− = send.
  return port.end === "a" ? -(d.sendA - d.arrivingA) / d.Z : (d.arrivingB - d.sendB) / d.Z;
}

/**
 * N-port junction: pressure continuity and *mass*-flux conservation. A plane wave carries mass
 * flux (A/c)·p′, so each port's mass admittance is A/c — ducts at different temperatures
 * (hot primaries into a cooler merge pipe) then scatter and conserve mass correctly.
 * Optional injected mass flow at the node and an optional compliance (lumped volume, m³):
 * with a volume, dp/dt = (c²/V)·dm/dt is integrated implicitly (backward Euler), giving
 * unconditionally stable Helmholtz behaviour.
 */
export class Junction {
  readonly ports: Port[];
  /** Node gauge pressure after the last solve. */
  pressure = 0;
  /** Net mass flow into the attached ducts after the last solve, kg/s. */
  netOutflow = 0;
  /** Speed of sound of the node gas for the compliance (defaults to the first port's duct). */
  nodeSoundSpeed = 0;
  private readonly outgoing: Float64Array;

  constructor(ports: Port[], public volumeM3 = 0, public meanPressurePa = P_AMBIENT, public gamma = 1.4) {
    this.ports = ports;
    this.outgoing = new Float64Array(ports.length);
  }

  /**
   * @param mExt injected mass flow at the node, evaluated at the previous node pressure (kg/s)
   * @param dt time step
   * @param conductance dmExt/dp (kg/(s·Pa), ≤ 0 for a feed that weakens as node pressure rises)
   */
  solve(mExt: number, dt: number, conductance = 0): void {
    let sumY = 0;
    let sumYP = 0;
    for (let k = 0; k < this.ports.length; k++) {
      const port = this.ports[k];
      const d = port.duct;
      const Y = d.area / d.c;
      sumY += Y;
      sumYP += Y * arriving(port);
    }
    const G = Math.min(0, conductance);
    let p: number;
    if (this.volumeM3 > 0) {
      const c = this.nodeSoundSpeed > 0 ? this.nodeSoundSpeed : this.ports[0].duct.c;
      const K = (c * c * dt) / this.volumeM3;
      p = (this.pressure + K * (mExt - G * this.pressure + 2 * sumYP)) / (1 + K * (sumY - G));
    } else {
      p = sumY - G > 0 ? (2 * sumYP + mExt - G * this.pressure) / (sumY - G) : 0;
    }
    this.pressure = p;
    let out = 0;
    for (let k = 0; k < this.ports.length; k++) {
      const port = this.ports[k];
      const pin = arriving(port);
      this.outgoing[k] = p - pin;
      send(port, p - pin);
      out += (port.duct.area / port.duct.c) * (p - 2 * pin);
    }
    this.netOutflow = out;
  }

  outgoingFor(index: number): number {
    return this.outgoing[index];
  }
}

/**
 * Passive radiation load of an unflanged circular pipe end: causal (1,2) Padé
 * approximation of the Levine–Schwinger reflection coefficient (Silva et al.,
 * JSV 322, 2009: n1 = 0.167, d1 = 1.393, d2 = 0.457), bilinear-mapped.
 * `process` returns the reflected wave; `volumeAcceleration` (m³/s²) drives a
 * free-field monopole p = ρ0·dQ/dt / (4πr) at the observer.
 */
export class RadiationLoad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private prevQ = 0;
  volumeVelocity = 0;
  volumeAcceleration = 0;

  private c = 343;
  /** κ in r = κ|u|/c; 4/(3π) for a thin-walled unflanged edge, 0 for purely linear radiation. */
  nonlinearLoss = 4 / (3 * Math.PI);

  constructor(private readonly sampleRate: number, readonly radius: number, c: number) {
    this.setSpeedOfSound(c);
  }

  setSpeedOfSound(c: number): void {
    this.c = c;
    const n1 = 0.167;
    const d1 = 1.393;
    const d2 = 0.457;
    const k = 2 * this.sampleRate * (this.radius / c);
    const den0 = 1 + d1 * k + d2 * k * k;
    this.b0 = (-1 - n1 * k) / den0;
    this.b1 = -2 / den0;
    this.b2 = (-1 + n1 * k) / den0;
    this.a1 = (2 - 2 * d2 * k * k) / den0;
    this.a2 = (1 - d1 * k + d2 * k * k) / den0;
  }

  /**
   * Terminate the incident wave; returns the wave reflected back into the duct.
   * A passive series resistance r = κ·|u|/c (κ = 4/(3π), quasi-steady vortex shedding at a
   * sharp unflanged edge — Ingard/Disselhorst–van Wijngaarden; EngineLab PipeRadiationModel)
   * is cascaded with the linear load using the previous sample's mouth velocity, which keeps
   * the element causal and energy-dissipating.
   */
  process(incident: number, Z: number): number {
    const history = this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    const area = Math.PI * this.radius * this.radius;
    const u = Math.abs(this.prevQ) / area;
    const r = Math.min(4, (this.nonlinearLoss * u) / this.c);
    const radIncident = (2 * incident + r * history) / (2 + r * (1 - this.b0));
    const radReflected = this.b0 * radIncident + history;
    const reflected = incident - radIncident + radReflected;
    this.x2 = this.x1;
    this.x1 = radIncident;
    this.y2 = this.y1;
    this.y1 = radReflected;
    const q = (radIncident - radReflected) / Z;
    this.volumeAcceleration = (q - this.prevQ) * this.sampleRate;
    this.prevQ = q;
    this.volumeVelocity = q;
    return reflected;
  }
}

/**
 * Series flow resistance between the downstream end of `up` and the upstream
 * end of `down` (catalyst monolith, muffler baffles, filter element). The
 * resistance is linearised about the mean flow, R = K·ρ·|ū|/A, so it carries
 * the steady pressure drop (real backpressure) and damps the acoustic wave
 * passing through it — both passive.
 */
export class ResistiveJoint {
  /** Linearised resistance, Pa per kg/s. */
  R = 0;
  /** Mass flow through the joint this sample, kg/s. */
  massFlow = 0;
  meanVelocity = 0;
  constructor(readonly up: Duct, readonly down: Duct, public lossCoefficient: number) {}

  solve(): void {
    const a1 = this.up.arrivingB;
    const a2 = this.down.arrivingA;
    // Duct-end relation in mass-flow form: p = 2a ∓ (c/A)·ṁ
    const Z1 = this.up.c / this.up.area;
    const Z2 = this.down.c / this.down.area;
    const m = (2 * (a1 - a2)) / (Z1 + Z2 + this.R);
    this.massFlow = m;
    this.up.sendB = a1 - Z1 * m;
    this.down.sendA = a2 + Z2 * m;
  }

  /** Block-rate update of the linearised resistance from the smoothed mass flow: Δp = K·ρu²/2 → R = K·u/(2A). */
  updateResistance(meanMassFlow: number): void {
    const area = Math.min(this.up.area, this.down.area);
    this.meanVelocity = Math.abs(meanMassFlow) / (Math.max(0.05, this.down.rho) * area);
    this.R = (this.lossCoefficient * (this.meanVelocity + 2)) / (2 * area);
  }
}

/**
 * Nonlinear orifice between a pressure reservoir (absolute pressure/temperature
 * supplied each sample) and the end of a duct. Used for individual throttle
 * bodies, bellmouths, BOV and wastegate dumps. Solves the compressible orifice
 * law implicitly against the duct's characteristic impedance.
 */
export class ReservoirOrifice {
  massFlow = 0;
  volumeFlow = 0;
  private prevQ = 0;
  volumeAcceleration = 0;

  constructor(readonly port: Port, private readonly sampleRate: number) {}

  /** @returns the wave sent back into the duct. Positive massFlow = reservoir → duct. */
  solve(cdA: number, reservoirPa: number, reservoirK: number, orificeFlow: (cdA: number, pa: number, ta: number, pb: number, tb: number) => number, ambientPa: number): number {
    const duct = this.port.duct;
    const pin = arriving(this.port);
    const sign = this.port.end === "a" ? 1 : -1;
    const Z = duct.Z;
    const rho = duct.rho;
    const T = duct.temperatureK;
    // g(m) = m − F(p_res, p_port(m)), p_port = amb + 2 pin + sign·Z·m/ρ ; monotone in m.
    const F = (m: number) => orificeFlow(cdA, reservoirPa, reservoirK, ambientPa + 2 * pin + (sign * Z * m) / rho, T);
    let lo = 0;
    let hi = F(0);
    if (cdA <= 0 || hi === 0) {
      this.massFlow = 0;
    } else {
      let glo = -hi;
      let ghi = hi - F(hi);
      let m = hi;
      for (let it = 0; it < 18; it++) {
        m = ghi !== glo ? hi - (ghi * (hi - lo)) / (ghi - glo) : 0.5 * (lo + hi);
        const g = m - F(m);
        if (Math.abs(g) <= 1e-9 + Math.abs(m) * 1e-6) break;
        if ((g > 0) === (ghi > 0)) { hi = m; ghi = g; glo *= 0.5; } else { lo = m; glo = g; ghi *= 0.5; }
      }
      this.massFlow = m;
    }
    const q = this.massFlow / rho;
    this.volumeFlow = q;
    this.volumeAcceleration = (q - this.prevQ) * this.sampleRate;
    this.prevQ = q;
    const pPort = 2 * pin + sign * Z * q;
    send(this.port, pPort - pin);
    return pPort - pin;
  }
}
