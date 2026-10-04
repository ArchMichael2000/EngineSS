# EngineSS handoff

The state of the Engine Sound Simulator (ESS) rebuild, written for a fresh session with no prior context. Read this first, then `docs/reference-sources.md`, which holds every model, constant, source and validation result in detail.

## 1. Where things stand

| | |
|---|---|
| Repository | `ArchMichael2000/EngineSS` |
| Working branch | `ccr-96a885ac-rsc0db` (the v16 work from `claude/serene-wozniak-vibhtn`, plus the legacy split and browser testing), merged to `main` |
| `main` | Runs v16 only. The v0–v15 engine lives in `legacy/` (see `legacy/README.md`) and is never shipped. |
| Live site | GitHub Pages builds `dist/` from `main` via `.github/workflows/pages.yml` (not from `docs/`). The build fails if the legacy worklet reaches it. |
| Tests | `npx vitest run`: 166 tests pass (≈ 100 s on 4 vCPU, CPU-heavy). CI (`.github/workflows/ci.yml`) runs typecheck, build and tests on pushes and PRs. |
| Browser | `npm run test:browser -- --url <app>/simulator --stress`: every reference engine, every control and export in Chromium. Results: `docs/browser-verification.md`. |
| Typecheck and build | `npm run build` (runs `tsc -b`, then `vite build`) |
| Robustness | `npx vite-node scripts/fuzzConfigs.ts -- 20 1`: 80/80 random configurations pass across seeds 1–80 |

**Goal (from the owner):** take over EngineSS and rebuild the core sound engine for quality and realism across all configurations, including ones that don't exist but could. Also rebuild the reference and data sources, researching the internet and public repositories.

**Owner preferences:**
- Show, don't tell: render audio and figures and measure, rather than assert.
- Never use the phrase pattern "It's not [X], it's [Y]".

## 2. How the simulator works (v16 physical core)

Every sound comes from physics. Nothing is a sampled or synthesised "engine tone".

1. Cylinders (or Wankel chambers) run thermodynamics: valve or port flow, Wiebe heat release, wall heat transfer, knock.
2. Their valve and port flows drive 1-D waveguide ducts: intake runners, plenum, airbox and snorkel; exhaust primaries, collectors, catalyst, mufflers and tailpipes.
3. Open ends radiate. Structure-borne noise comes from combustion forces and mechanical impacts.
4. An observer sums monopole sources with distance, ground reflection and shielding, for several listener perspectives.

| File | Responsibility |
|---|---|
| `shared/ess/spec.ts` | `EngineSpec`: the physical description (geometry, cam, intake, exhaust, forced induction, calibration, vehicle, `cycle`, `twoStroke`, `rotary`, `diesel`). Also `cycleDegrees()`, `displacementLitres()` and `rotaryChamberVolume()`. |
| `shared/ess/resolveSpec.ts` | Maps the app's Quick/Advanced/Physical config (`shared/engineTypes.ts`) to an `EngineSpec`, filling gaps with family defaults. All per-family default logic lives here. |
| `shared/ess/geometry.ts` | Firing-schedule solver: crank types, banks, firing orders. Has separate two-stroke (360°) and rotary (1080°, faces) schedules, plus exhaust grouping. |
| `shared/ess/cylinder.ts` | Chamber model. Slider-crank or Wankel volume (`chamber()`), cam lobes with VVT and lift switching, two-stroke ports and crankcase pump, rotary ports, implicit finite-amplitude valve/port flow (`solveValve`), spark Wiebe or diesel double-Wiebe combustion, knock (Livengood–Wu) with ringing, Woschni heat transfer. |
| `shared/ess/engine.ts` | `EngineSimulator`: per-sample crank dynamics and block-rate ECU control (idle PI and spark, VVT schedule, rev limiters, overrun fuel cut, diesel governor, afterfire, start/stop, vehicle mode). Telemetry, and a `costEstimate` for CPU budgeting. |
| `shared/ess/waveguide.ts` | Ducts (fractional-delay lines, losses, mean-flow damping, steepening), junctions, radiation loads, resistive joints. |
| `shared/ess/exhaust.ts` | Builds the exhaust network: collectors, turbine stages, crossovers, catalyst, resonator, mufflers, J-pipes, Helmholtz resonators, valved bypass. Also two-stroke expansion chambers and rotary rotor-shared ports. |
| `shared/ess/intake.ts` | Runners, plenum or ITBs, throttle, idle bypass, airbox, filter, snorkel resonator. Also rotary rotor-shared intake runners. |
| `shared/ess/forcedInduction.ts` | Turbocharger (Greitzer compressor with surge, turbine, wastegate PI with anticipation, pneumatic BOV) and superchargers (Roots, twin-screw, centrifugal), each with acoustic sources. |
| `shared/ess/structure.ts` | Block and head modal radiator driven by combustion, piston slap, valve seating, timing drive, starter. |
| `shared/ess/observer.ts` | Listener perspectives, propagation, ground reflection (coherent only below ≈ 600 Hz). |
| `shared/ess/vehicle.ts` | Drivetrain: gearbox, compliant driveline, stick-slip clutch, automated shifts, launch control. |
| `shared/ess/resample.ts` | Band-limited upsampler for reduced internal rates. |
| `shared/ess/fuzz.ts` | Random-configuration generator and checks. Options `{ diesel, twoStroke, rotary }` disable the variant draws. |
| `shared/ess/reference/engines.ts` | 25 reference engines with provenance and published torque/power. |
| `shared/ess/render.ts` | Offline rendering (export). |
| `client/src/lib/ess/essProcessor.ts` | AudioWorklet. Chooses the internal rate tier (1, 5/6 or 2/3 of the device rate) from `costEstimate` × a measured machine factor, steps down on sustained overload, and crossfades on config changes. |
| `client/src/lib/audioEngine.ts`, `client/src/hooks/useAudioEngine.ts` | Main-thread bridge (config, controls, shift, ignition, telemetry). |
| `client/src/components/QuickBuildPanel.tsx` | Includes the **Engine Type** selector (four-stroke gasoline/diesel, two-stroke, Wankel rotary) and a Rotors count. |
| `client/src/components/PhysicsPanel.tsx` | Detailed controls: VVT/VTEC, exhaust hardware, diesel injection, two-stroke ports and pipe, rotary ports. |
| `client/src/components/PlaybackController.tsx` | Free/Dyno/Drive modes, crank and ignition-off, shifting, launch control, brake, gear and speed readouts. |

The legacy v0–v15 additive model (`legacy/engineSoundModel.ts`, its worklet, mix and profile switches) is kept in `legacy/` for A/B renders (`scripts/renderBaseline.ts`) and runs its tests with the suite. `shared/legacyIsolation.test.ts` fails on any import of it from `client/`, `shared/` or `server/`. Saved configurations with an old `soundProfile` play on v16.

### Scripts
- `scripts/renderForCompare.ts -- <engineKey> <perspective> sweep r0 r1 secs out | idle secs out`: renders a reference engine to WAV plus a speed track. `PATCH='{json}'` deep-merges into the config.
- `scripts/compareRecording.py analyse|compare`: tachometer-less order tracking and order-profile comparison against real recordings.
- `scripts/fetchReferenceAudio.py`: fetches and verifies the 10 CC0 recordings in `reference-audio/` (manifest: `shared/ess/reference/real-audio-manifest.json`).
- `scripts/fuzzConfigs.ts -- [count] [firstSeed]`: robustness sweep.
- `scripts/verifyForcedInduction.ts -- [outDir]`: 19 turbo/supercharger acoustic checks.
- `scripts/renderV16.ts`, `scripts/renderBaseline.ts`, `scripts/analyzeBaseline.py`, `scripts/analyzeReferenceCorpus.py`: audit and corpus tooling.

## 3. What has been done

Listed in commit order on the branch. Details and numbers are in `docs/reference-sources.md`.

1. **v15 audit and v16 physical core** (commits `e544b38` … `09a08d8`). Measurement harness for the old engine. New physics core wired into the app and worklet. Validated against 21 reference engines, with fixes for everything that exposed.
2. **Core refinements** (`6d92574`, `129b306`, `0b93e35`). Finite-amplitude valve ports, catalyst damping, decel airflow schedule. Structure-borne noise calibrated to HL-CEAD engine-bay statistics.
3. **Real-recording comparison** (`37ea404`, `f52847e`, `d2ed59e`). 10 CC0 recordings and order-tracking comparison tooling. Fixing ground-reflection coherence took the 2JZ order-profile error from 7.6 to 4.9 dB.
4. **Variable valve timing** (`e2af66e`). Cam phasers with an ECU schedule, and two-step lift switching (VTEC-style), with reference data for 12 engines.
5. **Exhaust and intake hardware** (`f4d8e95`). J-pipes, Helmholtz resonators, glasspack, valved exhaust, snorkel resonator, mean-flow duct damping.
6. **Vehicle mode** (`c005374`). Gearbox, compliant driveline, clutch, automated shifts with flat-shift cut and rev-match blip, launch control, starter-driven start/stop. LS3 runs 0–100 km/h in 4.5 s (published 4.6–4.9 s).
7. **Robustness and real-time performance** (`a5183d0`):
   - Random-configuration fuzzing.
   - Soft rev limiter now cuts spark as well as fuel, with an overspeed backstop.
   - Valve-solver speedups.
   - Adaptive internal sample rate with the band-limited upsampler. Physics is rate-independent: W16 torque at 32 kHz is within 0.15 % of 48 kHz.
8. **Forced-induction verification** (`cbf16bb`). 19/19 acoustic checks:
   - No-BOV lift-off now gives deep surge at 32 Hz.
   - Pneumatic, turbo-sized BOV.
   - Wastegate anticipation: tip-in overshoot 17 % → 10.5 %.
   - Spectrograms in `docs/figures/forced-induction-events.png`.
9. **Diesel** (`9441892`):
   - Hardenberg–Hase ignition delay and Watson premixed fraction.
   - Double-Wiebe heat release; chamber ringing as clatter; pilot injection lowers idle combustion noise by about 5 dB.
   - Unthrottled all-speed governor with smoke limit and torque-rise taper.
   - References: VW EA288 2.0 TDI, Cummins 6BT 5.9 12V.
10. **Two-stroke** (`43f297a`):
    - Piston-uncovered ports; crankcase pump with reed or piston-port induction.
    - Displacement-mixing scavenging with two-zone outflow enthalpy, and a header slug that the plugging pulse returns to the cylinder.
    - Expansion chamber sized from wave timing, L_t = c(θ − 40°)/(12N).
    - Two-stroke idle air, friction and inertia.
    - Reference: Yamaha RD350LC.
11. **Wankel rotary** (`9eb09c6`):
    - Exact chamber volume; 1080° face cycle; faces share each rotor's ports.
    - Peripheral and side ports, with stock/street/bridge/peripheral porting presets.
    - Long-chamber heat transfer; seal friction.
    - Reference: Mazda 13B FC S5 NA.
12. **Engine-family figure** (`b8f875d`). `docs/figures/engine-families.png` compares LS3, EA288, RD350LC and 13B through idle, a full-throttle rev and a lift-off.

### Validation snapshot (published vs simulated, simulated dyno)

The full table is in `docs/reference-sources.md` §4. The tests require ±12 % for the pinned engines.

| Engine | Torque | Power |
|---|---|---|
| GM LS3 | +5 % | −6 % |
| Ferrari F140 | +1 % | −2 % |
| Porsche 9A1 | −3 % | −1 % |
| Nissan VR38 | −1 % | +9 % |
| Bugatti W16 | +5 % | +14 % |
| VW EA288 (diesel) | −3 % | 0 % |
| Cummins 6BT (diesel) | +7 % | +1 % |
| Yamaha RD350LC (two-stroke) | −3 % | −5.5 % |
| Mazda 13B (rotary) | −3 % | +11 % |

High-revving NA engines read 10–13 % low at peak power (F136, S54, K20A); see the note in the docs.

## 4. Conventions and gotchas

- **Typecheck with `npx tsc -b`.** `npx tsc --noEmit -p .` checks nothing, because the root tsconfig only lists project references.
- **Running scripts:** use `npx vite-node <file> -- args`. Under vite-node the "is this the main module" check fails, so CLI entry points are separate files that import a library (for example `fuzz.ts` and `fuzzConfigs.ts`).
- **Long synchronous tests:** `shared/ess/ess.test.ts` yields a macrotask after each test (`afterEach`). Without that, vitest's 60 s RPC (`onTaskUpdate`) times out. Keep new long simulations in separate `it` blocks.
- **Cycle lengths:**
  - Four-stroke: 720° per cycle.
  - Two-stroke: 360°.
  - Rotary: 1080° of e-shaft per face.
  - For rotaries, `spec.cylinders` is the number of faces (3 × rotors), `quick.cylinderCount` is rotors, and `quick.displacement` follows Mazda's convention (rotors × one chamber). `displacementLitres(spec)` counts every face.
- **Fuzz seeds:** variant draws (diesel, two-stroke, rotary) happen last, so a seed's base configuration doesn't change when a variant is added. A seed can still become a variant, so tests pin variants off where a specific engine matters (seed 34 is the gasoline 10 L turbo I8 limiter case).
- **Prefer physical fixes over fudge factors.** Each calibrated constant is listed with its basis in `docs/reference-sources.md` §1, "Calibrated constants". Add new ones there.
- **Git:**
  - Develop on the session's designated branch and merge to `main` through a PR (the owner has given standing permission).
  - Do not open a PR unless the owner asks.
  - Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: <session link>`.
  - Never put model identifiers in repository content.
- **Network:** the cloud environment used so far blocked most outbound hosts. Reference audio was fetched by a helper session in a "Full Access" environment the owner created on claude.ai. Use that environment for downloads.

## 5. What still needs to be done

Ordered by priority. Each item says what "done" looks like.

### A. Ship it
1. ~~Browser-test the new UI and worklet.~~ Done; see `docs/browser-verification.md`, including the oddities seen in the captures that are still unexplained.
2. ~~Merge to `main`.~~ Done; the owner gave standing permission to open and merge PRs to `main`.

### B. Realism against real audio (the main open goal)
3. **Recordings for the new families.** The 10 CC0 recordings cover only four-stroke gasoline engines plus a radial.
   - Find CC0/CC-BY recordings of a common-rail diesel, an old mechanical diesel, a two-stroke (road bike or dirt bike) and a rotary (13B, ideally both stock and peripheral-port).
   - Freesound and the EngineLab manifest are good starting points.
   - Add them to `real-audio-manifest.json` and `reference-audio/`, then compare with `compareRecording.py` the way the 2JZ was done.
   - Done when each family has a measured order-profile error in the docs, with model fixes for whatever it exposes.
4. **Extend the four-stroke comparisons.** The LS3 idle recording is an unidentified cammed V8, and the EJ25 and Harley order assignments are uncertain. Find tachometer-tagged or well-identified recordings: sweeps, dyno pulls, steady segments.
5. **Interior (cabin) perspective.** The boom gain (0.00175 Pa per N·m) is unverified because there are no open interior recordings. Find any and calibrate.

### C. Known model gaps (each documented with numbers in `docs/reference-sources.md`)
6. **Rotary:**
   - +11 % power at 7000 rpm on the 13B: the auxiliary/6PI intake ports aren't modelled.
   - No Renesis (side exhaust) or 13B-REW (sequential twin turbo) reference yet.
   - Pistons have a piston-slap source, which rotaries skip; rotaries have no specific mechanical noise source (apex seals, stationary gears).
7. **Two-stroke:**
   - The torque curve is flatter than the real RD350LC's.
   - No exhaust power valve (YPVS-style).
   - Scavenging is single-zone composition with a mixing profile (exponent 1.8). A two-zone model would be more faithful.
   - No reed-petal noise.
   - No uniflow or blown two-stroke diesels (Detroit, marine); the fuzz forces two-strokes to gasoline.
8. **Diesel:**
   - Turbo is modelled with a wastegate, where real diesels use variable-geometry turbines.
   - Full-load exterior sound is mostly broadband through the turbine/wastegate path; verify against recordings.
   - No injector tick, EGR, cold start or glow plugs.
9. **Forced induction:**
   - Deep-surge frequency is 96 % of the Helmholtz frequency; Dehner & Selamet measured 63–82 %.
   - The 2JZ is modelled as one large turbo; sequential or twin turbos aren't.
   - No anti-lag.
10. **High-revving NA engines** read 10–13 % low at peak power: head and port breathing at high speed.
11. **Vehicle mode** is tested only with the LS3. The motorcycle drivetrain variant and vehicle defaults for two-strokes and rotaries are untested.

### D. Performance and housekeeping
12. CPU (single vCPU of the build machine, 48 kHz):
    - W16 ≈ 1.22× real time, 0.81× at the 2/3 tier.
    - LS3 ≈ 0.71×.
    - A 4-rotor reached 1.66× under four parallel processes.
    The profile is flat: valve solver ≈ 20 %, duct reads ≈ 14 %. Further speedups would need algorithmic change, such as fewer secant iterations or block-rate gas-state glides.
14. The export path (`shared/ess/render.ts`, `ExportPanel.tsx`) works through `EngineSimulator`, but it hasn't been exercised with the new families.

## 6. Quick start for the next session

```bash
git fetch origin main && git checkout main
npm ci
npx tsc -b && npx vitest run            # 166 tests
npx vite-node scripts/fuzzConfigs.ts -- 20 1
npx vite-node scripts/verifyForcedInduction.ts
npx vite-node scripts/renderForCompare.ts -- mazda-13b-fc exterior-rear sweep 1500 7500 6 /tmp/13b
```
