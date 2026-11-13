# EngineSS handoff

The state of the Engine Sound Simulator (ESS) rebuild, written for a fresh session with no prior context. Read this first, then `docs/reference-sources.md`, which holds every model, constant, source and validation result in detail.

## 1. Where things stand

| | |
|---|---|
| Repository | `ArchMichael2000/EngineSS` |
| Working branch | `claude/elegant-albattani-7t1qgq` (PR #4, November 2026): X layouts (Cross-Four and shared-pin), link rods, faster core, two-stroke work, engine view, moving listeners, steady idle. Earlier work is merged to `main`. |
| `main` | Runs v16 only. The v0–v15 engine lives in `legacy/` (see `legacy/README.md`) and is never shipped. |
| Live site | GitHub Pages builds `dist/` from `main` via `.github/workflows/pages.yml` (not from `docs/`). The build fails if the legacy worklet reaches it. |
| Tests | `npx vitest run`: 221 tests pass (≈ 140 s on 4 vCPU, CPU-heavy). CI (`.github/workflows/ci.yml`) runs typecheck, build and tests on pushes and PRs. |
| Browser | `npm run test:browser -- --url <app>/simulator --stress`: every reference engine, every control and export in Chromium. Results: `docs/browser-verification.md`. |
| Typecheck and build | `npm run build` (runs `tsc -b`, then `vite build`) |
| Robustness | `npx vite-node scripts/fuzzConfigs.ts -- 40 1`: 120/120 random configurations pass across seeds 1–120 (X engines, 17–24 cylinders, X exhaust arrangements and firing presets included) |

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
| `shared/ess/geometry.ts` | Firing-schedule solver: crank types, banks, firing orders (an exact dynamic programme; 24 cylinders in ≈ 40 ms). Has separate two-stroke (360°) and rotary (1080°, faces) schedules, the Cross-Four X layout with its module phasing, and exhaust grouping. |
| `shared/ess/rods.ts` | Master-and-link rod kinematics for radial rows: per-cylinder TDC offset, stroke and tabulated piston motion. |
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
| `client/src/components/QuickBuildPanel.tsx` | Includes the **Engine Type** selector (four-stroke gasoline/diesel, two-stroke, Wankel rotary), a Rotors count, and the **X (Cross-Four)** controls: modules, cylinder tilt, module phasing, with the pair phase, crank offsets and rocking couple read out. Slider values can be typed. |
| `client/src/components/PhysicsPanel.tsx` | Detailed controls: VVT/VTEC, exhaust hardware, diesel injection, two-stroke ports and pipe, rotary ports. |
| `client/src/components/EngineView.tsx` | Animated cross-section drawn from the solved schedule and spec: banks, pins, rods (link rods on radials), strokes, firing; plan along the crank; firing timeline. Wankels draw housing and rotors. |
| `client/src/components/PlaybackController.tsx` | Free/Dyno/Drive modes, crank and ignition-off, shifting, launch control, brake, gear and speed readouts. |

The legacy v0–v15 additive model (`legacy/engineSoundModel.ts`, its worklet, mix and profile switches) is kept in `legacy/` for A/B renders (`scripts/renderBaseline.ts`) and runs its tests with the suite. `shared/legacyIsolation.test.ts` fails on any import of it from `client/`, `shared/` or `server/`. Saved configurations with an old `soundProfile` play on v16.

### Scripts
- `scripts/renderForCompare.ts -- <engineKey> <perspective> sweep r0 r1 secs out | idle secs out`: renders a reference engine to WAV plus a speed track. `PATCH='{json}'` deep-merges into the config.
- `scripts/compareRecording.py analyse|compare`: tachometer-less order tracking and order-profile comparison against real recordings.
- `scripts/fetchReferenceAudio.py`: fetches and verifies the 10 CC0 recordings in `reference-audio/` (manifest: `shared/ess/reference/real-audio-manifest.json`).
- `scripts/fuzzConfigs.ts -- [count] [firstSeed]`: robustness sweep.
- `scripts/verifyForcedInduction.ts -- [outDir]`: 19 turbo/supercharger acoustic checks.
- `scripts/renderPreset.ts -- <presetKey> sweep|steady|free-rev <seconds> <out.wav>`: any preset (reference, Saber, factory) through the live chain to a stereo WAV.
- `scripts/plotSpectrograms.py out.png "Title=a.wav" …`: spectrogram contact sheet.
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
| GM LS3 | +7 % | −3 % |
| Ferrari F136 | −5 % | −6 % |
| Ferrari F140 | +4 % | 0 % |
| Porsche 9A1 | +2 % | 0 % |
| Nissan VR38 | +5 % | +6 % |
| Bugatti W16 | +11 % | +9 % |
| Rolls-Royce Vulture (shared-pin X-24) | | −0.1 % |
| VW EA288 (diesel) | −3 % | +7 % |
| Cummins 6BT (diesel) | +8 % | +3 % |
| Yamaha RD350LC (two-stroke) | −1 % | −3 % |
| Mazda 13B (rotary) | +7 % | +3 % |

High-revving NA engines now read 6–7 % low at peak power (F136, S54, K20A; 12–13 % before the November accessory and cam work). The Honda CRM250 two-stroke is the outlier at −24 % / −26 %; see §5 item 9.

### Live-site feedback round (October 2026)
- **Drone above ~6000 rpm.** The core no longer clips per sample. `shared/ess/leveler.ts` (slow auto level + 5 ms look-ahead limiter at −2 dBFS) runs in the worklet and in `render.ts`; `listener.autoLevel` switches Auto/Physical level. The browser compressor is now only a safety net.
- **Exhaust valve solver.** Past the suction limit the wave flow continues linearly, and the bracketed fallback widens until it brackets the root. This removed full-vacuum waves that ended in one sample (test: "valve wave solve").
- **Orphaned worklet nodes.** `stop()` sends `dispose`; the processor returns false and stale messages are ignored.
- **Display.** Smoothed telemetry at ≤ 8 Hz, latched status flags, gauge hysteresis, slow firing chase. Sliders have a 28 px hit area and hold their value while dragged.
- **Radials.** Even counts are staggered rows; every count 3–18 fires evenly (test: "radials fire evenly").

### November 2026: X layout, link rods, faster core, two-strokes (PR #4)
- **Cross-Four X layout (`x`).** Built to the owner's Saber SB4–SB16 study (`docs/reference-sources.md` §4): modules of four cylinders on four pins 90° apart, axes tilted t off horizontal, opposed pairs in phase, pairs 90° + 2t apart, rod planes 1·3·2·4, modules clocked for even firing or least rocking couple (ported from the study; 64/64 cases agree). Default proportions 96 × 190 mm with 400 mm rods. Presets: SB4, SB8, SB12, SB16, a square (45°) SB16, a low-couple SB12 and a turbo-diesel SB8. The study does not say whether the engine is spark or diesel, two- or four-stroke; the presets are four-stroke gasoline except the diesel one, and the Engine Type selector switches the rest.
- **Firing solver.** Exact dynamic programme instead of trying 2^(n−1) assignments; reproduces all 2,330 schedules of the old solver (the test keeps an exhaustive search as its oracle).
- **Master-and-link rods on radials** (`rods.ts`): link pistons reach TDC up to 3.7° off, so a Wasp Junior fires at 75–83° where it was a flat 80°. Radial cylinders are numbered with the rotation (1-3-5-7-9-2-4-6-8). `physical.articulatedRods: false` restores plain rods.
- **CPU: 15–38 % less** by removing heap allocation from the audio loop (see §4 "Performance rules").
- **Two-strokes:** steepening through the expansion chamber, oil-fouled silencer packing, a dilution ignition limit (four-stroking), and no car body around a motorcycle engine. Order-profile error against the CRM250 and MZ recordings 14–19 → 10–13 dB.
- **Engine view** in the app (`EngineView.tsx`), typed slider values, displacement to 60 L, redline from 1500 rpm.
- **Crank inertia** scales with stroke² above car proportions.

### November 2026, second round: owner decisions, moving listeners, steady idle (PR #4)
- **Owner decisions built.** Two- and four-stroke on every X engine (toggle in the X panel). Exhaust arrangements as options: side collectors, one collector per bank, separate pipes, tuned pipes on two-strokes, rear or side exit. Firing order from presets (default, even sides, bunched sides), by tapping opposed cylinders to swap them, or typed and checked against the solver (`FiringOrderEditor.tsx`). Up to 24 cylinders on every piston layout.
- **Shared-pin X** (`physical.xPins: "shared"`): four banks on one pin per row with master-and-link rods, Rolls-Royce Vulture reference at −0.1 % of its published power.
- **Pass-by and fly-over listeners** with Doppler (`observer.ts`, re-aimed every 16 samples). In Drive mode the pass-by follows road speed.
- **Half-rate tier** in the worklet (`RATE_TIERS = [1, 5/6, 2/3, 1/2]`) for 20–24 cylinders on slow machines.
- **Centrifugal blowers** sized from redline airflow and the tip speed their rated boost needs: Merlin 84 kPa of 83, FA20 Vortech 44–52 of 48, Vulture 38–40 of 41.
- **Idle.** The largest audible change of the round; numbers in `docs/reference-sources.md` §4 "Idle". Half-second idle speed now holds 1–3 % on the reference engines (it was 6–7 % on stock engines, and the flat-six preset and the long-cam F136 swung between a quarter and twice their target). Four changes: cycle-to-cycle variation recalibrated (COV of IMEP 7 % on a mild cam instead of 19 %); idle spark feedback 70°/unit error up to MBT; phased cams park on wider centrelines when they are longer than the family cam; overlap back-flow carries what the cylinder last expelled. The two-stroke dilution misfire no longer applies to four-strokes (it stalled the V10 preset every few seconds).
- **Accessory drag** is flat to 1500 rpm then constant power, plus the Patton–Nitschke–Heywood auxiliary term. **Structure-borne level** follows Anderton's 50·log N on spark engines above 2000 rpm.
- **Reference data:** F136 and S54 cam durations, 13B runner length and intake closing, CRM250 scavenging. The rotary's +11 % at 7000 rpm is now +3 %.
- **Lesson kept as a rule:** run the whole suite before every push. Two pushes went out with a stale test (the worklet's rate tiers) and failed CI.

## 4. Conventions and gotchas

- **Performance rules for the audio loop** (each one was measured; breaking them brings back hundreds of MB/s of garbage):
  - Give every numeric class field an initial number (`c = 0`, never a bare `c: number;`). A field first created as `undefined` is stored as a generic value and every later fractional store allocates.
  - Do not pass fractions to, or return them from, functions on the per-sample path unless the function is tiny. The optimiser boxes them whenever it does not inline the call, and large callers (`tick`, `Cylinder.step`, `solveValve`) run out of inlining budget. Pass them through fields (`cyl.alphaDeg`, `vsD`, `vsG`) or write the code in place.
  - No `for…of`, closures or object literals per sample.
  - Check with the allocation sampler, not a timer: `node --cpu-prof` shows "(garbage collector)", and `HeapProfiler.startSampling` with `includeObjectsCollectedByMinorGC` names the allocating function. Timing on the cloud container varies ±10 % between runs, so compare builds with interleaved runs.

- **Typecheck with `npx tsc -b`.** `npx tsc --noEmit -p .` checks nothing, because the root tsconfig only lists project references.
- **Running scripts:** use `npx vite-node <file> -- args`. Under vite-node the "is this the main module" check fails, so CLI entry points are separate files that import a library (for example `fuzz.ts` and `fuzzConfigs.ts`).
- **Long synchronous tests:** `shared/ess/ess.test.ts` yields a macrotask after each test (`afterEach`). Without that, vitest's 60 s RPC (`onTaskUpdate`) times out. Keep new long simulations in separate `it` blocks.
- **Cycle lengths:**
  - Four-stroke: 720° per cycle.
  - Two-stroke: 360°.
  - Rotary: 1080° of e-shaft per face.
  - For rotaries, `spec.cylinders` is the number of faces (3 × rotors), `quick.cylinderCount` is rotors, and `quick.displacement` follows Mazda's convention (rotors × one chamber). `displacementLitres(spec)` counts every face.
- **Fuzz seeds:** variant draws (diesel, two-stroke, rotary) happen last, so a seed's base configuration doesn't change when a variant is added. A seed can still become a variant, so tests pin variants off where a specific engine matters (seed 34 is the gasoline 10 L turbo I8 limiter case).
- **Judge idle on statistics, not on one instant.** Speed at a single moment after start is chaotic: any change to the model moves it by hundreds of rpm on a loping engine, and a 2 s check passed by luck for months while the V10 preset stalled every few seconds. Use half-second means over 8 s or more (the preset test in `ess.test.ts` does; so does the survey in `docs/reference-sources.md` §4 "Idle").
- **Run the whole suite before every push**, and the fuzz sweep after any change to combustion, friction or idle control.
- **Prefer physical fixes over fudge factors.** Each calibrated constant is listed with its basis in `docs/reference-sources.md` §1, "Calibrated constants". Add new ones there.
- **Git:**
  - Develop on the session's designated branch and merge to `main` through a PR (the owner has given standing permission).
  - Open a draft PR for the session's branch once it is pushed; the owner merges.
  - Commit trailers: the `Co-Authored-By` line the session is given, and `Claude-Session: <session link>`.
  - Never put model identifiers in repository content.
- **Network:** the cloud environment used so far blocked most outbound hosts. Reference audio was fetched by a helper session in a "Full Access" environment the owner created on claude.ai. Use that environment for downloads.

## 5. What still needs to be done

Ordered by priority. Each item says what "done" looks like.

### A. Ship it
1. ~~Browser-test the new UI and worklet.~~ Done; see `docs/browser-verification.md`, including the oddities seen in the captures that are still unexplained.
2. ~~Merge to `main`.~~ Done; the owner gave standing permission to open and merge PRs to `main`.

### B. Realism against real audio (the main open goal)
Done in October 2026: 14 open recordings added and compared (`scripts/compareCorpus.py`, results in `docs/reference-sources.md` §4). Still open:
3. **Two-strokes: half done.** The 2–8 kHz deficit is now 12–17 dB on light free revs (was 24–30) and near zero at full throttle without a silencer. What remains is probably engine-side: the structure-borne level at high speed is 10–15 dB under Anderton's empirical law for petrol engines (≈ 50·log N; the model follows ≈ 30·log N), and air-cooled fins, piston rattle and reed noise are not modelled. A two-stroke recording with a known microphone position would settle how much is the recording chain. Chamber-shell radiation was estimated and rejected (reference doc §4).
3a. **Structure-borne level vs speed.** Spark engines now gain the missing 20 dB per decade above 2000 rpm (limited to 12 dB), which follows Anderton's 50·log N slope. The absolute level at speed is still unanchored: a level-calibrated engine-bay recording at 4000–6000 rpm would settle it.
4. **More off-firing energy in real engines.** Diesels and the FA20 carry 2–8 dB more energy between the firing orders than the renders. Candidates: log-manifold geometry (unequal pulse paths), more cylinder-to-cylinder spread. An end-collector manifold overshoots.
5. **No open Wankel recording.** Keep looking (Freesound, Commons, Archive); the one Sampling+ clip is local-only.
6. **Cabin perspective.** Open interior clips exist (four committed), but none names its engine or speed, so the boom gain stays unverified. An identified interior recording with known rpm would calibrate it.
7. **Prechamber diesels** (Mercedes OM601/OM602, VW IDI): not modelled, and the 190 D comparison is the worst (15.5 dB).

### C. Known model gaps (each documented with numbers in `docs/reference-sources.md`)
Done: variable-geometry turbines for common-rail diesels; Drive mode for every family (limiter-aware shifts, power-based gearing); the rotary stationary-gear mesh; no more four-stroke chain whine on two-strokes or rotaries. Still open:
8. **Rotary:** +7 % torque, +3 % power after giving the NA six-port engine its 40 cm runners and 40° ABDC intake closing (it was +11 % at 7000 rpm). No Renesis or 13B-REW reference yet; apex-seal noise relies on the port-closing impulses.
9. **Two-stroke torque curve: measured, not fixed.** The CRM250 reads −24 % / −26 % and its torque stays within 10 % from 4000 to 9000 rpm. Charging efficiency sits at 0.49–0.53 whatever the pipe length, which is the cylinder volume left at port closing filled at about 1.1 bar: nothing raises the trapped pressure. The plugging pulse is missing at the port. Driven alone, the chamber returns 70 % of a pulse 2.8 ms later when the port end is closed and almost nothing when it is a pressure release; in the engine the port behaves like the second case while the transfers are open (it answers a −17 kPa suction with +10 kPa of outflow). The blow-down pulse is 33–43 kPa, weak for an engine on the pipe, and the header rule gives 53 mm where a real 250 is nearer 44 (estimate). Measurements and the scripts' method are in `docs/reference-sources.md` §4 "Two-stroke: where the plugging pulse goes". Start there, with a measured port-pressure trace (Blair 1996 compares measured and computed ones) as the target, before adding a power valve.
10. **Turbo deep surge** stays the mild type at 96 % of Helmholtz (measured 63–82 %). It needs a measured negative-flow compressor characteristic. Sensitivities are in §1.
11. **High-revving NA engines** read 6–7 % low at peak power (F136, S54, K20A), after the accessory law and realistic cam durations. The S54's torque peak is 10 % low. What is left is probably intake and head detail the family defaults do not carry.
11a. **Long-overlap idle.** The well-mixed cylinder puts a long-overlap cam's idle at 0.4–0.7 burned gas (the V10 preset reads 0.71 at 77 kPa manifold pressure), about 1.5 times what such engines measure. The idle is steady now, but the residual scale itself is unverified; a two-zone treatment of overlap back-flow is the candidate. The MZ ETZ 250 idles at 1700 rpm against its 1300 target.
11b. **Leveler and impulsive idles.** The auto level reads sparse peaks low (0.4 s attack) and lifts a popping idle toward the limiter, so the two-stroke SB8's idle comes out within 2 dB of its full-throttle level. A 5 ms peak detector restores the swing but lowers every engine's full-throttle level by 3–4 dB; left as it was.
12. **Diesel extras:** no injector tick, EGR, cold start or glow plugs.
13. **Forced induction:** no sequential or twin-turbo staging, no anti-lag.

### E. X-engine layouts: built (November 2026)
The owner's Saber Cross-Four replaced the earlier four-banks-on-one-pin plan, and the classic shared-pin X (Vulture) followed with master-and-link rods. The owner's answers are built in: both cycles, exhaust arrangements as options, firing order by preset or by hand, 24 cylinders everywhere. Still open:
- **Application** (vehicle, boat, aircraft, stand): sets gearing, inertia and the listener positions. The presets run in the default car.
- **Intake arrangement** is one plenum for every arrangement of exhaust.

### D. Performance and housekeeping
14. CPU: the November pass removed allocation (15–38 % less). What is left is spread evenly: duct reads 14 %, the per-sample engine loop 14 %, cylinder step 13 %, valve residuals and solver 20 %, junction solves 8 %. Tabulating slider-crank motion (as link-rod cylinders already do) is worth about 3 %. Beyond that the steps are structural: sub-rate thermodynamics, or threads, which need cross-origin isolation that GitHub Pages can't provide.
15. Export: exercised in the browser for diesel, two-stroke, rotary and turbo engines; it renders in a Web Worker.

## 6. Quick start for the next session

```bash
git fetch origin main && git checkout main
npm ci
npx tsc -b && npx vitest run            # 221 tests
npx vite-node scripts/fuzzConfigs.ts -- 40 1
npx vite-node scripts/verifyForcedInduction.ts
npx vite-node scripts/renderForCompare.ts -- mazda-13b-fc exterior-rear sweep 1500 7500 6 /tmp/13b
npx vite-node scripts/renderPreset.ts -- saber-sb8 sweep 12 /tmp/sb8.wav
```
