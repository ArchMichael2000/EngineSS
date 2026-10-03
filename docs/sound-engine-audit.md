# EngineSS Sound Engine Audit (v15 baseline)

Status: baseline audit before the core rebuild. Every claim about current behaviour below is either quoted from the code or measured with the harness in `scripts/` (see [Reproducing the measurements](#reproducing-the-measurements)).

---

## 1. What the repository is

| Area | Files | Role |
|---|---|---|
| Sound model (offline / export) | `shared/engineSoundModel.ts` (1,596 lines) | Firing-event analysis, per-event "pulse" synthesis, accessories, output shaping. Used by WAV/MP3 export and the server renderer. |
| Sound model (live) | `client/src/lib/audioEngine.ts` → `COMBUSTION_PROCESSOR_CODE` (≈1,070 lines inside a template string) | Hand-maintained JavaScript copy of the same model, run as an `AudioWorkletProcessor`. This is what users hear. |
| Host audio graph | `client/src/lib/audioEngine.ts` → `AudioEngine` | Worklet → (dry / lowpass / bandpass) → master → limiter gain → compressor. Also runs legacy turbo/supercharger oscillators, the BOV burst, the rev limiter and RPM inertia, all on `requestAnimationFrame`. |
| Config & presets | `shared/engineTypes.ts` | Engine config schema, 8 factory presets, firing-order table, 9 "sound profile" versions (v0, v8–v15). |
| Mix profile | `shared/realtimeAudioMix.ts` | For v9+ the live path is 98% dry; the lowpass/bandpass filters and legacy oscillators are muted (gain 0) but still running. |
| Capture/tuning | `shared/audioAnalysis.ts`, `client/src/lib/captureAnalysis.ts`, `shared/referenceCapture.ts` | Analyses an uploaded recording (Meyda/Essentia features) and maps summary statistics to 15 tuning weights with hand-written linear formulas. |
| Tests | `shared/*.test.ts`, `server/engine.test.ts` (97 tests, all pass) | Guard continuity, non-silence, loudness balance and parameter sensitivity. None assert acoustic correctness against physics or recordings. |

### Development history

12 commits. The first was a zip upload (2026-07-23); the other 11 all landed on 2026-07-26:

1. `fca7f21` imports the full app already at **v15**. Versions v0–v14 exist only as `if (profile >= vN)` branches inside the model; they have no separate history.
2. `fdcfabe`, `ddbca50`, `01b0e36` set up GitHub Pages: built bundles are committed into `docs/` (six JS bundles of 0.5–2.6 MB each are now in history).
3. `9a37cb4` → `db640ca` → `df264b8` attempt a **v16 "Forced Induction"** profile ("earlier turbo spool and aggressive Hellcat-style supercharger whine") and then patch two worklet playback failures it caused.
4. `1d463cd` **reverts all of v16** ("Revert to v15 clean handoff").
5. `f6970c4`, `b1fbc3c` re-apply smaller forced-induction onset tweaks and a "smooth high-RPM clarity output" pass on top of v15.

The version names tell the tuning story. Each step after v11 removes something that sounded wrong: v12 "reduced airflow wash", v13 "airwash control", v14 "randomized hiss removed", v15 "stricter air-noise removal". The model has been tuned by ear through subtraction. Every noise source eventually got multiplied by zero (Section 3), which left a purely tonal engine.

---

## 2. How v15 produces sound (as built)

```
config ──► buildEngineSoundAnalysis()
             firing order (table or 1..n), intervals (720/n, or ±22% "odd-fire" stagger),
             bank = odd/even cylinder, pan ±0.42, per-cylinder hash "personality",
             4 fixed resonances: exhaust ¼-wave, "block-body", primary ¼-wave, intake ¼-wave (c = 343 m/s)
                 │
audio thread ─► crank angle += rpm·6/sr  (per sample)
             on each firing angle crossed: addPulse()  → new Pulse object with 37 frozen parameters
             every sample, for every live pulse (up to 40–58):
                 ~12 decaying sines + 6 transient shapes + tanh folds   (≈40 exp/sin calls)
             + global layers: rumble, density bed, intake, valvetrain, 32-order "orderTone",
               turbo / supercharger
             → DC block → soft-knee clip → host: dry gain → master → compressor → speakers
```

Each firing event becomes a bundle of decaying sinusoids at fixed frequencies. Overlapping bundles from successive events are summed. The approach is additive/modal: no waveguide, no shared filter, and no pressure or flow state.

---

## 3. Sound-source inventory

For each layer: what it claims to represent, how v15 builds it, what drives its variance, the real mechanism, and how effective it is. "Live in v15" means its output is non-zero with the current profile.

### 3.1 Per-firing-event layers (`addPulse` / pulse loop)

| Layer | Live in v15? | Implementation (v15) | Variance drivers | Real mechanism | Verdict |
|---|---|---|---|---|---|
| **sub** | yes, dominant at low RPM | Decaying sine at the exhaust ¼-wave frequency (`343/(4·L)`, clamped 28–135 Hz; ≈26–30 Hz for presets), τ = 1.82 × pulse decay | load (+7% freq), ±0.4% per cylinder | Low-frequency standing wave in the tailpipe. Exists, but exhaust gas runs at 400–900 °C, so c ≈ 500–670 m/s and the mode sits **1.5–2× higher** than modelled. It also shifts with load as gas temperature changes. | Physically motivated, numerically wrong. It is also re-instantiated per event with per-cylinder detune, so successive events ring slightly different "pipes". |
| **body** | yes, the loudest single layer | Decaying sine at "block-body" frequency 38–92 Hz (`42 + 14·disp/5 + 18·disp/cyl`), gain 0.56 × 1.24 | displacement, load (+9%), layout (flat 0.92, inline 1.05) | No real source. Engine blocks radiate structure-borne noise in the hundreds of Hz to kHz range. A 40–90 Hz ring that does not follow RPM is invented. | **Harmful.** Measured as the loudest spectral peak at high RPM in 4 of 8 presets (both V8s, V12, supercharged V8), sitting at 64–75 Hz while the firing frequency is 260–720 Hz (Section 4.2). The result is an RPM-independent drone. |
| **growl** | yes | Decaying sine at `primary¼-wave × 1.18–1.52 + 0.36·body` (90–380 Hz) | crank type, displacement | Loosely the primary-pipe resonance | A fixed-pitch formant. Plausible role, but the frequency is arbitrary and uses cold-air c. |
| **pipe** (3 partials) | yes | Sines at `pipeHz × {1, 1.41, 2.03}` (180–1250 Hz), gains 0.072 / 0.028 / 0.010 | exhaust character, displacement, load, ±2.3% random per event (`resonatorDrift`) | Pipe/muffler resonances excited by each pulse | The inharmonic ratios (1.41, 2.03) and per-event random drift turn a resonance into a warble. A real pipe is one linear system whose modes do not jitter between events. |
| **presence** (3 partials) | yes, first 36–52 ms only | Sines at 850–5200 Hz, ±8% random per event, scaled ×0.34 | brightness, load, high-RPM trims | Stands in for HF radiation and the pulse "edge" | Tonal stand-in for what is broadband in reality. Measured >2 kHz energy is <1% in almost every state (Section 4.3). |
| **pressureStep / pressureTail** | yes | Difference of exponentials (0.34 ms rise, 2.6 ms fall) minus a 2.2/13 ms tail | edge weight, density smoothing | The blowdown pressure pulse when the exhaust valve opens. This is **the** primary exhaust sound source. | Right idea, but the shape is fixed: it ignores RPM (a real pulse lasts a crank-angle duration, so it shortens as RPM rises), load and pressure ratio. |
| **blowdownBark** | yes | tanh fold of 3 sines locked to `pipePhase` + pressure step | load, skew, ±12% per cylinder | Nonlinear steepening of high-amplitude blowdown waves | Its "bark" comes from sine harmonics rather than wave steepening. |
| **pipeReflection** | yes | 2 delayed taps (1.2–7.5 ms, 2.4–14 ms) with random delays redrawn per event | pipe length, muffler volume, open headers | Reflections from collector/muffler/tail impedance changes | Correct concept. Random per-event delays smear what should be a fixed comb filter. |
| **edge / nonlinearBite / pressureSnap** | yes (small) | Short exponential transients and tanh of pressure deltas | brightness, edge weight, high-RPM trims | Attack sharpness | Cosmetic shaping, small in v15. |
| **throatPulse** | barely (×0.08, noise term = 0) | tanh fold of pressure step | — | Valve-throat jet noise | Effectively removed. |
| **airBurst, exhaustRadiation, rasp, crack, pressureGrain** | **no** (all forced to 0 by v14/v15 flags) | Filtered random noise bursts per event | — | Turbulent jet/flow noise at the valve and tailpipe. In real exhausts this broadband component grows steeply with flow velocity and dominates the "rasp" at high load. | **Missing.** Removing these fixed the hiss but also removed real flow noise. The hiss came from noise that was not pulse-synchronous, band-shaped or velocity-scaled, so the fix was in the wrong place. |
| **combustionVariance / microDelay** | yes | ±5% uniform amplitude, ±0.11 ms timing per event | high-RPM trim | Cycle-to-cycle combustion variation (COV of IMEP ≈ 1–3% at load; much higher at idle and with big cams) | Constant at all loads, and idle character does not drive it. Lumpy idle comes from a separate sine LFO. |

### 3.2 Continuous / global layers (`synthesizeSample`)

| Layer | Live in v15? | Implementation | Real mechanism | Verdict |
|---|---|---|---|---|
| **rumble** | yes | 3 sines at engine orders 1, 1.5, 2 (phase from crank), × (1 + idle LFO) | Low engine orders from bank pulse grouping / imbalance | Redundant with the event-derived spectrum. It is added on top, not derived from it. |
| **densityBed** | yes (V10/V12) | Sines at cylinder-count cycle orders | — | A patch to make dense engines feel "full". Has no physical counterpart. |
| **orderTone** | yes | 32 sines at every half-order, gains from a DFT of the event comb | Order content falls out of the firing schedule automatically if the source is right | Duplicates information the pulse train already contains, as an extra additive layer. |
| **intake** | weak | Half-wave-rectified sine at **1.15 × crank order** (NA) / 0.95 (boosted), plus a resonance sine whose pitch moves with throttle | Induction pulses happen at the same orders as firing, filtered by runner/plenum/airbox resonances. Throttle changes the amplitude and plate noise; it does not change pipe pitch. | **Wrong.** 1.15 is a non-integer order, so this layer is never phase-locked to the engine. The throttle-dependent resonance pitch has no physical basis. |
| **valvetrain** | weak | `sin^18` tick at crank order 6, gated by combustion envelope | Valve seating/cam events: camshaft = ½ crank speed, events scale with cylinders × valves | Fixed 6th order regardless of engine. Mechanical/combustion clatter (1–4 kHz block radiation, piston slap, DI injector tick) is absent. |
| **idle lope** | yes | Deterministic sine at 1.35 × cycle rate | Big-cam idle is driven by per-cycle combustion variation and RPM hunting | A periodic wobble sounds mechanical. Real lope is irregular. |

### 3.3 Forced induction

| Layer | Implementation | Real mechanism | Verdict |
|---|---|---|---|
| Turbo spool | `spool = f(rpm − threshold, throttle)`, first-order lag 70–240 ms | Shaft speed follows exhaust enthalpy (rpm × load × temperature) with rotor inertia; spools over seconds | Has no link to exhaust energy, and the boost readout is cosmetic. |
| Turbo whistle | 2 sines at 2.2–9.8 kHz ∝ spool | Audible tones are shaft-order (synchronous) and sub-synchronous tones plus BPF at a few kHz and up, together with broadband "whoosh" | Measured >2 kHz energy for the turbo preset is 0.0–0.3% across all operating points (Section 4.3), which is barely present. |
| Whoosh / flow noise | **0 in v15** (`compressorTexture = 0`) | Broadband compressor flow noise ∝ mass flow; the most recognisable turbo cue | **Missing.** |
| Compressor "breath" | 28–120 Hz sine × spool | No clear physical counterpart | Low-frequency hum labelled as turbo. |
| Wastegate | sine at flutter rate when load > 0.55 and spool > 0.65 | Wastegate opening bleeds exhaust past the turbine (louder, brighter exhaust plus a flow hiss) | Tone only, with no effect on the exhaust path. |
| Turbine damping | — | The turbine extracts pulse energy, so turbo engines sound muffled and smoothed | **Missing.** This is the largest perceptual difference between turbo and NA engines. |
| BOV | Host-side `Math.random()` noise × exp decay, bandpass 1750 Hz, triggered when throttle falls from >0.5 to <0.2 with "boost" > 5 | Pressurised charge venting through a valve (a broadband jet, about 100–300 ms) | Reasonable shape. Not deterministic (`Math.random`), it bypasses the model and the export, and has no compressor-surge flutter alternative. |
| Supercharger whine | Sines at rotor Hz × {8.2 roots, 10.5 twin-screw, 13.5 centrifugal} plus lobe pulses (`sin^2.4`) | Roots/TVS: lobe-pass (rotor rev × lobes, 3–4 lobes, helical twist smooths it) plus timing-gear mesh. Centrifugal: step-up gear mesh and impeller BPF. | Closest to plausible of all the layers. The gear-mesh multipliers are guesses, with no tooth counts or pulley ratio exposed. |

### 3.4 Engine behaviour that shapes sound

| Behaviour | v15 | Real | Verdict |
|---|---|---|---|
| Throttle → RPM | `targetRpm = idle + (redline − idle) × throttle`, smoothed at display frame rate | Torque vs. load and inertia; free-rev blips overshoot and fall | No dynamics, so blips, flares and fall-off do not sound right. |
| Load / overrun | Pulse amplitude ∝ `(0.22 + 0.78·throttle)(0.62 + 0.38·load)`, so firing continues at 13.6% when throttle = 0 | Closed throttle at speed → fuel cut → no combustion. You hear pumping pulses, intake/mechanical noise and possibly afterfire pops. | Overrun keeps the same combustion character, only quieter, and has no pops or crackle. |
| Rev limiter | Host ducks a gain node to 0.68–0.92 and lowers target RPM | Fuel or ignition cut **skips firing events**, which makes the stutter; ignition cut adds exhaust bangs | The volume dip skips no events, so there is no stutter. |
| Firing intervals | 720/n, or ±22% generic stagger for "odd-fire"; **bank angle is never used** | Intervals follow from crank-pin phasing + bank angle (45° V-twin 315/405, 90° V6 common-pin 90/150, 60° V6 120, 72° V10 72) | V-twins, V4s, odd-fire V6/V10 cannot be represented correctly. |
| Firing orders | Table for I4, I6, V6, V8 (2), V10, V12, flat-4/6. **Everything else falls back to 1-2-3-…-n** | I5 1-2-4-5-3, I8 1-6-2-5-8-3-7-4, 9-cyl radial 1-3-5-7-9-2-4-6-8, W12, V4… | Inline-5, I8, radials and W engines get impossible firing orders. |
| Unequal-length headers | Random 1.5–6.3 ms per-cylinder delay from a hash | Delay follows primary length difference / hot-gas c | Directionally right but not tied to geometry. |

---

## 4. Measured failures

Renders of the live worklet for all 8 factory presets at 6 steady operating points plus a 6 s WOT sweep, analysed by `scripts/analyzeBaseline.py`.

### 4.1 Loudness falls as RPM rises

WOT sweep, 1000 RPM → redline, throttle 1.0:

| Preset | RMS start → end | Slope |
|---|---|---|
| v8-crossplane | −18.5 → −18.4 dBFS | −3.2 dB per RPM doubling |
| flat-6 | −12.4 → −22.1 dBFS | −4.2 dB |
| inline-6 | −14.7 → −23.4 dBFS | −2.8 dB |
| inline-4-turbo | −5.4 → −16.3 dBFS | −2.0 dB |
| v12 | −9.9 → −11.5 dBFS | −1.4 dB |

At WOT, exhaust noise rises strongly with engine speed because mass flow through the valve curtain rises, and turbulent flow noise scales with a high power of velocity. An engine that gets quieter as it revs reads as "running out of breath". Steady-state points show the same pattern (e.g. inline-6 WOT: −15.9 dBFS at 3000 RPM, −21.2 dBFS at 6300).

Level is also unstable: the V10 swings from −0.9 dBFS (WOT 3000) to −13.0 (WOT 5100) to −4.5 (WOT 7650), a 12 dB range with near-clipping peaks. Fixed resonators line up with firing harmonics at some RPMs, and nothing controls the build-up.

### 4.2 The engine's pitch disappears at high RPM

The **loudest frequency** in each render, against the firing frequency:

| Render | RPM | Firing Hz | Loudest Hz |
|---|---|---|---|
| v8-crossplane WOT | 3900 | 260 | **64.9** |
| v8-crossplane WOT | 5850 | 390 | **69.9** |
| v8-flatplane WOT | 7650 | 510 | **63.9** |
| v12 WOT | 3000 | 300 | **74.9** |
| v12 WOT | 7200 | 720 | **70.9** |
| supercharged-v8 WOT | 6120 | 408 | **71.4** |

The dominant peak stays at 64–75 Hz while RPM nearly doubles: this is the `block-body` resonator (Section 3.1).

For 6 of 8 presets, the share of energy on engine orders falls from ~99% at idle to 11–23% at 90% redline WOT. Energy at the firing order and its harmonics falls to **2–13%** (v8-flatplane 2.2%, v12 5.1%, v8-crossplane 6.1%). The I4 turbo and V10 stay order-locked at that point, but the V10 does so through the uncontrolled resonance build-up described in 4.1. Per-event random detune, timing jitter, amplitude noise and hard pulse truncation scatter the rest off-order. At the top of the rev range, where an engine's pitch is most recognisable, the model barely carries it.

### 4.3 No air, no edge

* Spectral flatness (100 Hz–8 kHz) is 0.0001–0.015 in every state: essentially pure tones. v15 has zero stochastic sources (Section 3.1).
* Energy above 2 kHz is **under 1%** in 44 of 48 steady renders (max 3.0%, supercharger whine). Spectral centroid stays at 63–584 Hz.
* Real exhaust and induction recordings carry significant 1–5 kHz content (the "rasp"), and engineering literature ties perceived sportiness to roughness, sharpness and tonality together. v15 provides roughness (half orders) and tonality, but almost no sharpness.

### 4.4 Clicks from hard pulse truncation

An isolated V12 pulse is deleted at its `maxPulseAge` of 85 ms while its sub layer is still at −0.19 full scale; the next sample is −0.003. That is a 0.19 FS step on **every firing event** whenever the age cap is hit. `maxActivePulses` (40–58) splices out the oldest pulses the same way. Both caps exist to protect CPU (4.5).

### 4.5 It cannot run in real time for dense engines

Worklet CPU time ÷ audio time (Node 22, single thread, same JS engine as Chrome):

| Preset | idle | WOT 60% | WOT 90% |
|---|---|---|---|
| inline-4-turbo | 0.19 | 0.51 | 0.66 |
| v8-crossplane | 0.24 | 0.72 | 0.84 |
| v8-flatplane | 0.26 | 1.00 | **1.22** |
| v10 | 0.26 | 1.01 | **1.36** |
| v12 | 0.30 | 1.10 | **1.41** |

Above 1.0 the audio thread misses deadlines (dropouts). This explains the silence watchdog that rebuilds the worklet node (`monitorOutputContinuity`), the test names ("does not die or go silent…"), and the pulse caps that cause 4.4. Cost scales with pulses × layers × transcendental calls. A real-time engine needs roughly ≤0.2 here to leave headroom for the browser and slower devices.

### 4.6 Engineering debt that blocks progress

* **Two copies of the model.** The worklet is a hand-synced JS string, about 1,000 lines. They match today (offline and live renders measure identically), but every change must be made twice. The tests compare the copies for liveness only.
* **Version-flag sprawl.** 9 profile predicates (`isClarity…`, `isStaticClean…`, `isCleanHandoff…`) nest inside nearly every expression, often 4 deep. Branches for zeroed noise are still computed every sample.
* **About 1,400 numeric literals** in `engineSoundModel.ts` alone (duplicated in the worklet), almost none in physical units. Tuning one layer shifts others through shared gains.
* **Control at frame rate.** RPM, throttle, limiter and inertia run on `requestAnimationFrame` (≈60 Hz, paused in background tabs) and reach the audio thread by `postMessage`.
* **Event timing quantised to the sample.** No fractional-sample onset, so timing jitter is up to 22.7 µs.
* **Live ≠ export at the graph level.** Export skips the host compressor and master gain.
* **"Learned" tuning is a linear map from summary stats** (centroid, flatness, ZCR…) to 15 weights. It cannot fit a recording.
* **Tests lock in constants.** 57 KB of model tests assert today's numbers, so physically correct changes fail them.
* Legacy turbo/supercharger oscillators run permanently at gain 0. Built bundles are committed to `docs/` on every change.

---

## 5. How engine sound is made, and what the ear listens for

The rebuild should be organised around the real causal chain and the perceptual cues. This is the reference model; each item notes v15's status.

### 5.1 Physical sources (in order of contribution to exterior sound)

1. **Exhaust blowdown pulse**: when the exhaust valve opens, gas at several bar is released into the primary. The pulse amplitude scales with cylinder pressure at valve opening (load, boost, ignition timing). Its duration is a crank-angle window, so it shortens in time as RPM rises. *v15: fixed-shape pulse, amplitude from an ad-hoc power term.*
2. **Exhaust system acoustics**: primaries, collector/merge, X/H pipe, catalysts, resonators, mufflers, tailpipe. These are travelling waves in **hot gas** (c ≈ 20.05·√T[K], about 590 m/s at 600 °C), with reflections at every area change and an open-end radiation that favours higher frequencies. Mufflers act as transmission-loss filters (reactive chambers notch bands; absorptive packing removes HF). *v15: per-event decaying sines at cold-air frequencies.*
3. **Flow (turbulence) noise**: jet noise at the valve throat and tailpipe orifice, broadband, rising with a high power of flow velocity. It is modulated by the pulse because flow is pulsatile, so it arrives as "rasp" locked to firing and never as steady hiss. *v15: removed.*
4. **Induction**: intake valve opening sends a rarefaction wave up the runner. Runner, plenum (Helmholtz) and airbox resonances shape it. Throttle-plate flow noise appears at part throttle (high pressure drop). ITBs/velocity stacks radiate directly with little filtering. *v15: non-locked 1.15-order sine.*
5. **Combustion & mechanical (structure-borne)**: combustion pressure rise excites the block (1–4 kHz "clatter"), plus valvetrain, timing drive, injectors and piston slap. *v15: one 6th-order tick.*
6. **Accessories**: turbo (synchronous/sub-synchronous tones, BPF, broadband whoosh, turbine damping of the exhaust, BOV/surge), supercharger (lobe-pass + gear mesh), gearbox/driveline whine, cooling fan.

### 5.2 Order structure (falls out of 1–2 when the timing is right)

* Event at cycle angle θ → contributes at all half-orders, with phase set by θ. Firing order + bank angle + crank-pin phasing set the per-bank and per-pipe event spacing, which determines how strong the sub-firing (half) orders are at each outlet.
* Cross-plane V8 burble comes from each bank's 180-90-180-270 spacing reaching a separate pipe. Merge the banks with an X-pipe and it smooths out. Flat-plane, V12 and I6 have even per-pipe spacing.
* So the per-pipe topology (which cylinders feed which pipe, and where pipes merge) drives character as much as the firing order does. v15 approximates it with stereo panning only.

### 5.3 Perceptual cues (psychoacoustics)

| Cue | Physical correlate | Listener's word | v15 |
|---|---|---|---|
| Pitch | Firing frequency and its harmonic series | "revs", "note" | Weak at high RPM (4.2) |
| Roughness | Half-order beating; modulation 20–300 Hz, peak ≈70 Hz | "rumble", "burble", "sporty" | Present at mid RPM, drowned by the fixed 65 Hz drone high up |
| Fluctuation strength | <20 Hz modulation from CCV and lope | "lumpy idle", "cammy" | Periodic LFO only |
| Sharpness | 1–5 kHz content, flow noise, pulse steepness | "rasp", "aggressive", "crisp" | Almost absent (4.3) |
| Loudness growth | Rise in level with RPM × load | "pulling hard" | Inverted (4.1) |
| Tonality | Narrow tones (whine, whistle, drone) | "whine", "drone" | Present (accessories, fixed resonators) |
| Booming | Strong low orders/cabin modes at cruise | "drone" | Uncontrolled resonance spikes (V10) |
| Transient events | Pops, limiter stutter, BOV, gear shifts | "character" | Mostly missing |

---

## 6. Recommendation: rebuild the core

The failures in Section 4 come from the architecture, so parameter retuning cannot fix them:

* Pitch loss, drone and level instability come from per-event frozen sinusoids with random detune instead of one shared acoustic system.
* CPU overload and truncation clicks come from evaluating every live pulse's 40 transcendental functions every sample.
* Missing air and edge come from noise that was never tied to flow, so it was removed.
* Behaviour gaps (overrun, limiter, spool) come from having no engine state.

### 6.1 Proposed architecture (physically informed source–filter)

Lineage: Baldan et al. 2015 (procedural, physically informed engine synthesis) and AngeTheGreat's Engine Simulator (gas-dynamics → pressure waves → duct acoustics), simplified for a browser budget.

```
Control (audio-rate, inside the worklet)
  throttle, load, ignition/fuel cut ─► Engine dynamics: torque(rpm, throttle) − friction − load, inertia → rpm
                                      overrun fuel-cut, limiter event skipping, afterfire probability
Kinematics
  crank angle (double precision), fractional-sample event scheduler
  firing schedule DERIVED from crank-pin phasing + bank angle + firing order (validated table + generator)
Sources (per cylinder event, band-limited)
  exhaust blowdown pulse: amplitude ∝ cylinder pressure at EVO(load, boost, VE(rpm)); width = crank-angle window
  CCV: Gaussian, COV from idle character / load / rpm; misfire & cut gating
  intake rarefaction pulse; structure-borne combustion click (filtered noise burst)
  flow noise: noise × instantaneous flow velocity^n, pulse-synchronous, band-shaped
Propagation (O(1) per sample per duct, independent of RPM)
  per-primary digital waveguides (fractional delay, loss filter, c from gas temperature(load))
  scattering junctions at collector / X-pipe / H-pipe → muffler (reactive TL + absorptive LP) → tailpipe radiation HP
  intake: runner waveguides → plenum Helmholtz → airbox / filter → snorkel radiation
Accessories as coupled subsystems
  turbo: shaft ODE driven by exhaust enthalpy; turbine as pulse damper in the exhaust path;
         compressor RO/BPF tones + whoosh ∝ mass flow; wastegate bypass branch; BOV vs. surge flutter events
  supercharger: pulley ratio × lobes (lobe-pass) + gear tooth counts (mesh), bypass valve at part load
Listener
  tailpipe / engine bay / cabin / drive-by perspectives as transfer filters + distance & Doppler
Output
  one gain-staged mix, true-peak-safe limiter, identical for live and export
```

### 6.2 Engineering ground rules

1. **One DSP codebase.** Write the processor as a TypeScript module that Vite bundles for `audioWorklet.addModule`. The offline renderer, server renderer and tests import the same code. Delete `COMBUSTION_PROCESSOR_CODE`.
2. **Freeze v15** in a `legacy/` module for A/B comparison and saved configs. Start the new engine as v16 with no version flags inside the DSP.
3. **Physical units everywhere** (Pa, m, K, kg/s, Hz). Character presets map onto geometry, not onto gain multipliers.
4. **CPU budget gate:** V12 at redline ≤ 0.2 real-time factor in the harness.
5. **Objective acceptance gates** from `scripts/analyzeBaseline.py`: loudness rises with RPM at WOT; the dominant peak tracks firing order; firing-family energy ≥ a threshold at all RPMs; no truncation steps; flatness and HF share within ranges taken from reference recordings.
6. **Reference library first.** Collect licensed recordings per preset family (tailpipe and cabin; idle, steady and WOT sweep) and compare order-level curves (order vs. RPM) and 1/3-octave spectra. Then fit the tuning weights by optimisation against them, replacing the linear formulas.

### 6.3 Phased plan

| Phase | Scope | Exit criterion |
|---|---|---|
| P0 | Harness (done), reference recording set, acceptance metrics, bundling pipeline for a TS worklet | Metrics run in CI; v15 frozen as legacy |
| P1 | Kinematics + firing-schedule generator, blowdown source, exhaust waveguide network (I4, I6, cross/flat V8) | Pitch tracks firing at all RPMs; loudness rises with RPM; CPU ≤ 0.2 |
| P2 | Flow noise, intake system, structure-borne mechanical layer | Flatness/HF share in reference range; no static hiss |
| P3 | Engine dynamics, overrun fuel cut, limiter event skipping, afterfire | Blip/limiter/overrun A/B against recordings |
| P4 | Turbo (coupled) and supercharger rebuild | Spool lag from load; turbine muffling audible; BOV/flutter |
| P5 | Listener perspectives, fitted tuning from captures, remaining layouts (I5, V-twin, radial, W) | All presets pass gates |
| P6 | UI wiring, preset migration, retire legacy from default path | v16 default |

---

## Reproducing the measurements

```bash
npm ci
npm run audit:render -- baseline-renders          # renders live worklet + offline model (~2 min)
pip install numpy
python3 scripts/analyzeBaseline.py baseline-renders   # prints the tables, writes report.json
```

Metric definitions (`analyzeBaseline.py`): *order-locked %* is the energy within ±1.5 Hz of any half-order harmonic of `rpm/120`. *Firing-family %* is the energy at multiples of the firing order. *Flatness* is the geometric/arithmetic mean of the power spectrum between 100 Hz and 8 kHz. *cpuRT* is worklet CPU time ÷ audio duration. Steady renders discard the first 0.5 s.

## Sources

* Baldan, Lachambre, Delle Monache, Boussard, "Physically informed car engine sound synthesis for virtual and augmented environments", IEEE SIVE 2015: https://www.researchgate.net/publication/280086598_Physically_informed_car_engine_sound_synthesis_for_virtual_and_augmented_environments
* Engine Simulator (AngeTheGreat), community edition: https://github.com/Engine-Simulator/engine-sim-community-edition
* Siemens Simcenter, "What's an Order?": https://community.sw.siemens.com/articles/en_US/Knowledge/what-s-an-order
* Exhaust gas temperature and resonance shift (patent discussion of c in hot exhaust, resonance moving with load): https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10373602
* TRB Special Report 152, "Vehicle noise sources and noise-suppression potential": https://onlinepubs.trb.org/Onlinepubs/sr/sr152/sr152-003.pdf
* C. G. Gordon, "A study of exhaust noise…", NASA: https://ntrs.nasa.gov/api/citations/19690002231/downloads/19690002231.pdf
* "Model of psychoacoustic sportiness for vehicle interior sound", Applied Acoustics: https://www.sciencedirect.com/science/article/abs/pii/S0003682X17307624
* Genuit, "The sound quality of vehicle interior noise: a challenge for the NVH-engineers": https://www.researchgate.net/profile/Klaus-Genuit/publication/228602895_The_sound_quality_of_vehicle_interior_noise_A_challenge_for_the_NVH-engineers/links/548eee110cf225bf66a7f572/The-sound-quality-of-vehicle-interior-noise-A-challenge-for-the-NVH-engineers.pdf
* Sound & Vibration, "Automotive Sound Quality": http://www.sandv.com/downloads/0904cerr.pdf
* "Identification of Turbocharger Noise Sources Taking into Account Design Operating Conditions", Machines 2025: https://doi.org/10.3390/machines13100948
* "Investigation of Compressor Whoosh Noise in Automotive Turbochargers" (SAE 2009-01-2053): https://www.researchgate.net/publication/279157332_Investigation_of_Compressor_Whoosh_Noise_in_Automotive_Turbochargers
* Hagerty, "Dive inside an Eaton TVS supercharger": https://www.hagerty.com/media/maintenance-and-tech/dive-inside-an-eaton-tvs-supercharger/
* Duan et al., "The mechanism and effect factors of the combustion cycle-to-cycle variations in the spark ignition engine", 2024: https://scijournals.onlinelibrary.wiley.com/doi/10.1002/ese3.1879
* "A Brief Tour of Automotive Sound Sources", Designing Sound: https://designingsound.org/2014/07/08/a-brief-tour-of-automotive-sound-sources/
* Existing project notes: `docs/audio-research-notes.md`
