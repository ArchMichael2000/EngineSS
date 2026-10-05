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

### Live-site feedback round (October 2026)
- **Drone above ~6000 rpm.** The core no longer clips per sample. `shared/ess/leveler.ts` (slow auto level + 5 ms look-ahead limiter at −2 dBFS) runs in the worklet and in `render.ts`; `listener.autoLevel` switches Auto/Physical level. The browser compressor is now only a safety net.
- **Exhaust valve solver.** Past the suction limit the wave flow continues linearly, and the bracketed fallback widens until it brackets the root. This removed full-vacuum waves that ended in one sample (test: "valve wave solve").
- **Orphaned worklet nodes.** `stop()` sends `dispose`; the processor returns false and stale messages are ignored.
- **Display.** Smoothed telemetry at ≤ 8 Hz, latched status flags, gauge hysteresis, slow firing chase. Sliders have a 28 px hit area and hold their value while dragged.
- **Radials.** Even counts are staggered rows; every count 3–18 fires evenly (test: "radials fire evenly").

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
Done in October 2026: 14 open recordings added and compared (`scripts/compareCorpus.py`, results in `docs/reference-sources.md` §4). Still open:
3. **Two-strokes are too dull.** At every listener perspective their 2–8 kHz energy is 14 dB or more short of the CRM250 and MZ recordings. Soloed stems show weak outlet-jet and port-blowdown sources. Done when the tilt matches within a few dB without breaking the RD350LC's power.
4. **More off-firing energy in real engines.** Diesels and the FA20 carry 2–8 dB more energy between the firing orders than the renders. Candidates: log-manifold geometry (unequal pulse paths), more cylinder-to-cylinder spread. An end-collector manifold overshoots.
5. **No open Wankel recording.** Keep looking (Freesound, Commons, Archive); the one Sampling+ clip is local-only.
6. **Cabin perspective.** Open interior clips exist (four committed), but none names its engine or speed, so the boom gain stays unverified. An identified interior recording with known rpm would calibrate it.
7. **Prechamber diesels** (Mercedes OM601/OM602, VW IDI): not modelled, and the 190 D comparison is the worst (15.5 dB).

### C. Known model gaps (each documented with numbers in `docs/reference-sources.md`)
Done: variable-geometry turbines for common-rail diesels; Drive mode for every family (limiter-aware shifts, power-based gearing); the rotary stationary-gear mesh; no more four-stroke chain whine on two-strokes or rotaries. Still open:
8. **Rotary +11 % at 7000 rpm.** Volumetric efficiency rises with speed (79 → 88 %). Auxiliary ports would make it worse, not better; intake tuning is the suspect. No Renesis or 13B-REW reference yet; apex-seal noise relies on the port-closing impulses.
9. **Two-stroke torque curve.** Within 5 % of peak from 4000 to 8500 rpm. Trapping efficiency (≈ 0.55) doesn't respond to pipe tuning. Fix that before adding a power valve (YPVS / RC), which would otherwise only flatten the curve further. The CRM250 reads −30 % (118 hp/L).
10. **Turbo deep surge** stays the mild type at 96 % of Helmholtz (measured 63–82 %). It needs a measured negative-flow compressor characteristic. Sensitivities are in §1.
11. **High-revving NA engines** read 9–15 % low above about 21 m/s mean piston speed (the S54's −31 % is limiter interference on the dyno test). Candidates are the speed-squared friction and accessory-drag terms; don't change them without friction data.
12. **Diesel extras:** no injector tick, EGR, cold start or glow plugs.
13. **Forced induction:** no sequential or twin-turbo staging, no anti-lag.

### E. X-engine layout (the owner's goal; plan awaiting approval)
The plan with computed firing and exhaust-order maps for eight candidate X engines is at https://claude.ai/artifact/5qFs4DJC53PjnWmfA4WHxP. Phases: P1 geometry + throw-by-throw firing solver + layout panel; P2 articulated rods (X and radial); P3 four-bank exhaust/intake; P4 structure, balance, listener presets; P5 CPU (X24 ≈ 1.38 cores at full rate) and validation. The owner still has to say which X they mean (one crank with four banks, or other), bank angles, rods, cycle and application.

### D. Performance and housekeeping
14. CPU: no safe micro-optimisation left (valve tolerance tried and reverted; see §4 of the reference doc). The rate tiers hold real time (W16 at 32 kHz in Chromium). Next steps would be structural: sub-rate thermodynamics, or threads, which need cross-origin isolation that GitHub Pages can't provide.
15. Export: exercised in the browser for diesel, two-stroke, rotary and turbo engines; it renders in a Web Worker.

## 6. Quick start for the next session

```bash
git fetch origin main && git checkout main
npm ci
npx tsc -b && npx vitest run            # 166 tests
npx vite-node scripts/fuzzConfigs.ts -- 20 1
npx vite-node scripts/verifyForcedInduction.ts
npx vite-node scripts/renderForCompare.ts -- mazda-13b-fc exterior-rear sweep 1500 7500 6 /tmp/13b
```
