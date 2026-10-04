# ESS v16 reference sources and data provenance

This file says where every model and number in the v16 physical core (`shared/ess/`) comes from. It also records how each one was checked and what is still unverified. Read it together with `docs/sound-engine-audit.md`, which measures the v15 model this core replaces.

## 1. Physics models

| Subsystem | Model | Primary source | Where |
|---|---|---|---|
| Crank kinematics | Slider-crank, exact | Heywood, *Internal Combustion Engine Fundamentals* (2nd ed., 2018), ch. 2 | `cylinder.ts` `kinematics` |
| Cam lift | Harmonic lobe `L·(½+½cos kx)^γ`, calibrated at 0.050" | engine-sim `GenerateHarmonicCamLobeNode` (MIT), same formula and γ convention | `cylinder.ts` `CamLobe` |
| Valve flow | Compressible orifice, Cd(L/D) table, curtain/throat minimum | Heywood §6.3; Cd curve shaped on EngineLab `parts/camshafts.yaml` flow-bench data | `cylinder.ts` `flowArea` |
| Valve–duct coupling | Implicit: `p_port = 2p_in + Z·ṁ/ρ`, secant + Illinois fallback | Characteristic (Riemann-variable) boundary of 1-D acoustics | `cylinder.ts` `solveValve` |
| Heat release | Wiebe a=5, m=2; duration from bore, speed, density, dilution, λ | Heywood §9.2; Ghojel, *Int. J. Engine Res.* 11 (2010) | `cylinder.ts` `wiebeDuration` |
| Spark phasing | Closed-loop MBT: 50 % burn ≈ 9° ATDC | Heywood §9.3 (MBT ↔ CA50 ≈ 8–10°) | `cylinder.ts` `mbtAdvance` |
| Cycle-to-cycle variation | Burn-duration COV from dilution and charge density | Heywood §9.4; Duan et al., *Energy Sci. Eng.* (2024), doi:10.1002/ese3.1879 | `cylinder.ts` `ignite` |
| Wall heat transfer | Woschni (1967) | Woschni, SAE 670931 | `cylinder.ts` |
| Knock | Livengood–Wu integral, Douaud–Eyzat delay `τ = 17.68(ON/100)^3.402 p^−1.7 e^(3800/Tu)` ms, isentropic end gas | Livengood & Wu (1955); Douaud & Eyzat, SAE 780080 | `cylinder.ts` `integrateKnock` |
| Knock acoustics | First circumferential chamber mode `f = 1.84c/(πB)`, Q ≈ 18 | Draper, *Trans. ASME* 60 (1938) | `cylinder.ts` |
| Friction | Chen–Flynn FMEP `C + A·Pmax + B·Sp + Q·Sp²` plus a Stribeck low-speed term | Chen & Flynn, SAE 650733; Heywood §13.5 | `engine.ts` `frictionTorque` |
| Duct acoustics | Fractional-delay waveguides (Hermite) | Smith, *Physical Audio Signal Processing* (CCRMA) | `waveguide.ts` `DelayLine` |
| Duct losses | Visco-thermal plus lining absorption ∝ f^0.7, applied to the AC part only | Kirchhoff; Delany & Bazley, *Appl. Acoust.* 3 (1970) | `waveguide.ts` `Duct` |
| Finite amplitude | Wave steepening at local `c ± u` | Hirschberg et al., *JASA* 99 (1996); Msallam et al., *Acustica* 86 (2000) | `waveguide.ts` |
| Junctions | Mass-flux scattering with optional compliance (Helmholtz volume) | Munjal, *Acoustics of Ducts and Mufflers* (2nd ed., 2014), ch. 2 | `waveguide.ts` `Junction` |
| Junction losses | Direction-dependent `Δp = K·ρu²/2`; Borda–Carnot on jets leaving a duct | Idelchik, *Handbook of Hydraulic Resistance* | `waveguide.ts` `setPortLoss` |
| Open-end radiation | Levine–Schwinger reflection via (1,2) Padé fit, n1 0.167, d1 1.393, d2 0.457 | Levine & Schwinger, *Phys. Rev.* 73 (1948); Silva et al., *JSV* 322 (2009) | `waveguide.ts` `RadiationLoad` |
| Edge loss | Nonlinear vortex shedding at the pipe lip, `κ = 4/(3π)` | Ingard & Ising, *JASA* 42 (1967); Disselhorst & van Wijngaarden, *JFM* 99 (1980) | `waveguide.ts` |
| Outlet jet noise | Lighthill U⁸ scaling, Strouhal 0.2 band | Lighthill (1952); NASA SP-8073; Gordon, NASA CR (1969) | `exhaust.ts` |
| Mufflers and absorbers | Packed straight-through, chambered, reverse-flow boxes; perforate absorption | Munjal (2014) ch. 5–7; Selamet et al., *JASA* 115 (2004) | `exhaust.ts` |
| Compressor | Non-dimensional ψ(φ) speed line with a rising backflow branch; duct inertance (Greitzer B-model) | Greitzer, *J. Eng. Power* 98 (1976); Moore & Greitzer (1986) | `forcedInduction.ts` |
| Turbine | Nozzle from the manifold volume, implicit, wastegate in parallel | Watson & Janota, *Turbocharging the IC Engine* (1982) | `exhaust.ts` `solveTurbine` |
| Positive-displacement blowers | Roots / twin-screw displacement with leakage, pocket discharge pulsation | Eaton TVS literature; Hagerty TVS teardown | `forcedInduction.ts` |
| Radiation to listener | Monopole `p = ρQ̇/(4πr)`, ground reflection, shielding filters | Kinsler et al., *Fundamentals of Acoustics* | `observer.ts` |

### Calibrated constants and their basis

Each calibrated constant below was fitted against a measured reference, so changing one means re-running §4.

| Constant | Value | Basis |
|---|---|---|
| Chen–Flynn `C, A, B, Q` | 0.7, 0.005, 0.03, 0.0016 bar; Stribeck 0.3·e^(−Sp/4) | Warm motoring FMEP of about 1.05 bar at idle, 1.2 bar at 2000 rpm and 2.1 bar at 17 m/s. Checked against LS3 and F140 brake output (§4). |
| Knock delay scale | 3 × Douaud–Eyzat | Premium fuel (ON 95) at CR 10.5–11 is knock-limited only at low-speed WOT, matching production calibrations. LS3: 7.6° retard at 1500 rpm, under 1° at 4600 rpm. |
| Knock controller | +2.5 + 10·I on knock; +6·(I − 0.85) near the borderline; −0.3°/cycle recovery | Typical production strategy: fast retard, slow recovery. |
| Catalyst | Laminar monolith resistance 32μL/(d_h²·OFA): 400 cpsi, d_h 1.1 mm, OFA 0.75, 0.15 m brick; conical-diffuser shell at 1.5× pipe diameter | Gives 3–10 dB insertion loss on the LS3 (published converter TL is about 5–10 dB; Selamet et al.). |
| Mean-flow duct damping | α = f_D·M/(2D), f_D 0.025, M from the duct's slow travelling-wave parts | Quasi-steady turbulent friction linearised about the mean flow (Munjal 2014, ch. 2). Frequency-independent; reduces WOT level swing between system resonances by 1–2 dB. |
| Side-branch silencers | Quarter-wave J-pipe L = c/4f; Helmholtz neck 0.6× pipe diameter, L_eff from f = (c/2π)√(S/(V·L_eff)), end correction 1.7r | Classical resonator formulas (Munjal; Kinsler). Tuned with c at about 600 K; the true tuning drifts with gas temperature, as it does on cars. A Helmholtz at 133 Hz cuts the LS3's 2000 rpm firing order by about 7 dB. |
| Valved exhaust | Bypass parallel to the muffler; flap loss K = 0.3 + 4000·(1 − open)³; opens above its speed, or above 0.6× that speed at > 80 % pedal; 0.25 s actuator | Production valved-exhaust logic. Parallel paths can interfere (Herschel–Quincke), so open is not louder at every speed. |
| Intake snorkel resonator | OEM paper-filter airboxes default to a Helmholtz tuned to the firing frequency at 2200 rpm, cavity 0.4 L per litre | Cuts the K20A intake firing order by 6.4 dB at 2200 rpm (OEM resonators: 5–15 dB). |
| Vehicle drivetrain | 6-speed, final drive set for a plausible top speed at redline; torsional spring-damper driveline (≈5 Hz shuffle, ζ 0.3) in series with a stick–slip clutch (capacity 1.8× estimated peak torque); aero C_d·A 0.65 m², rolling 0.012 | LS3 car: 0–100 km/h 4.5 s vs 4.6–4.9 s published for LS3 Camaro/Corvette. |
| Shift and launch control | Automated clutch: torque-based launch (clutch torque = engine torque + J·12·Δω about a pedal-dependent launch speed); upshift = 40 ms clutch open + ignition cut held until 70 % re-engagement (flat shift) + 60 ms select + 120 ms engage; downshifts blip to rev-match | Sequential/DCT behaviour. Ignition cuts send charge into the exhaust, so flat shifts and launch control produce afterfire. |
| Start / stop | Starter torque (40 + 32·L) N·m falling to zero at 320 crank rpm; catch above 55 % of idle; start flare +30 % decaying over 1.5 s; starter mesh (132 ring teeth) and commutator whine through the block | Cranking settles at 190–260 rpm; catch at about 0.3 s; idle reached in about 2 s. |
| Plenum port loss | K 0.08 entering a runner, 0.9 leaving one | Radiused entry vs Borda–Carnot expansion (Idelchik). Brings the LS3 tuning trough to a realistic depth (VE 83 % at 5900 rpm). |
| Turbine area | 0.126 mm² per litre·rpm at threshold speed (small 0.22, balanced 0.32, large 0.45 × redline) | Energy balance with η_t 0.68, T3 ≈ 1100 K, PR_t ≈ 0.75·PR_c. |
| Compressor map | φ peak 0.04, design 0.09, choke 0.165; ψmax 0.56 | Exducer-based flow coefficient of modern ported-shroud stages. |
| Compressor wheel | Redline flow at φ 0.12, 470 m/s tip speed | Puts the WOT operating line right of peak efficiency and short of choke. |
| Idle feed-forward | Energy balance: friction + accessories + pumping at η 0.27/(1 + overlap/30) | Lands within about 10 % of the converged idle-valve opening on all 29 engines. |
| Accessory drag | (2.6 + 0.00035·rpm) · L | About 16 N·m on a 6 L V8 at idle, about 3 N·m on a 1 L motorcycle engine. |
| Structure excitation | Combustion F = A·p; piston slap J = m·√(2Fc/m) with 30 µm clearance; valve seating J = 0.05 kg × 0.25 m/s·(rpm/6000); timing drive 60 N noise + 36 N mesh tone (order 21) × (rpm/1000)^1.5 | Physical impulse magnitudes. Contact durations 100 µs (seat), 0.3 ms (slap), 150 µs (chain). |
| Structure radiation | 22 block modes (450–5200 Hz) and 16 head modes (1.5–6 kHz) scaled by size^−0.28; head/block mobility 0.8; 2nd-order radiation-efficiency high-pass at 2.4 kHz (below coincidence) | Fitted to HL-CEAD engine-bay statistics: 1.6 L i4 at 1500 rpm gives centroid 3.3 kHz (3.30), 2–8 kHz 62–76 % (63), flatness 0.30 (0.35), order-locked 25 % (27), crest 6.5 (5.5). Measured with `scripts/analyzeReferenceCorpus.py`'s own statistics. |
| Cabin boom gain | 0.00175 Pa per N·m of 25–180 Hz torque ripple | **Unverified.** No open interior recordings; set so WOT boom sits a few dB above the airborne exhaust. |
| Afterfire | Continuous afterburning (τ ≈ 3 ms when hot with O₂) while firing; discrete pops need fuel cut, limiter cut or misfires | Matches observed behaviour: crackle on lift-off and the limiter, flame without pops under load. |
| Rev limiter | Soft: a random share of cylinders loses spark *and* fuel, ramping from 0 at limiter − 30 rpm to all cylinders at limiter + 130 rpm, with 12° retard on the rest; every strategy has an overspeed ignition cut on instantaneous speed at limiter + 150 rpm | A fuel-only soft cut acts one cycle late. A 10 L turbo inline-8 with a light flywheel overran its 5300 rpm limiter to 6041 rpm with it. Spark cut acts on the charge already inducted. |
| Internal rate tiers | 1, 5/6, 2/3 of the device rate; cost estimate 0.11 + 0.050·cylinders + 0.004·ducts + 0.057·turbochargers (× real time at 48 kHz on the reference machine, ±25 %) times a measured machine factor, kept under 60 % of the audio thread; 2 s above 90 % steps down one tier | Physics is rate-independent: W16 brake torque at 32 kHz is within 0.15 % of 48 kHz. Kaiser-windowed sinc upsampler (32 taps, β 8): flat to 0.75 of the reduced Nyquist, images ≤ −60 dB. |

## 2. Engine data: `shared/ess/reference/engines.ts`

21 real engines are expressed as v16 configurations. Each entry carries a `provenance` record per parameter group:

* **published:** the manufacturer's specification as widely documented (bore, stroke, rod, compression, layout, bank angle, firing order, redline, and published torque and power).
* **engine-sim:** taken from the engine definitions in [ange-yaghi/engine-sim](https://github.com/ange-yaghi/engine-sim) (MIT), files `assets/engines/atg-video-*/*.mr`. Used for EJ25 (`06_subaru_ej25.mr`: 232/236° at 0.050", ICL 117 / ECL 112, γ 2.0) and 2JZ (`03_2jz.mr`: 220/220°, ICL/ECL 116, γ 1.1). These two were re-checked against the source files after an earlier transcription swapped durations and lifts.
* **estimated:** filled from `resolveEngineSpec()` family defaults. For boosted engines with estimated boost, the boost was set so the simulated output matches the published figure; that is what the label means.

Exhaust systems are representative builds for the vehicle class, not measured hardware.

## 3. Recorded audio references

### HL-CEAD engine-bay statistics: `shared/ess/reference/hlcead-engine-bay-stats.json`

* Source: Humain-Lab Car Engine Audio Database, Sidiropoulos & Papakostas, IEEE AIIoT 2021. Repository: [MachineLearningVisionRG/machine_biometrics](https://github.com/MachineLearningVisionRG/machine_biometrics).
* Produced by `scripts/analyzeReferenceCorpus.py`.
* Results:
  * spectral centroid p50 3.3–3.5 kHz;
  * the 2–8 kHz band holds about 62 % of the energy;
  * spectral flatness about 0.33–0.35;
  * order-locked energy 23–40 %.
* Caveats (also stored in the JSON):
  * phone recorder with noise and echo cancellation, so broadband figures are lower bounds;
  * mostly small inline-3 and inline-4 cars;
  * neutral (no load) at three steady speeds.
* Use: the target for the **engine-bay** listener perspective only. Exterior and tailpipe perspectives have no equivalent open dataset here yet.

### EngineLab CC0 corpus (indexed, not yet downloaded)

[zolaski333/EngineLab](https://github.com/zolaski333/EngineLab) `references/real-engine-audio/manifest.json` indexes ten CC0-1.0 Freesound recordings, each with a SHA-256. They map onto the reference engines above:

| Key | Recording | Source | sha256 (prefix) |
|---|---|---|---|
| 2JZ | Toyota Supra on a dyno | freesound.org/people/editboy23/sounds/496171 | 0b5f744f399b2463 |
| LS3 | V8 vehicle, field | freesound.org/people/overmedium/sounds/651534 | fd3619bac22d6fe3 |
| Hayabusa | Suzuki GSX1300, field | freesound.org/people/Heigh-hoo/sounds/49326 | 587c32fd4387072f |
| Big Twin | Harley-Davidson, field | freesound.org/people/allencote/sounds/81068 | 586e4e2f7b4dff19 |
| EJ25 | 2003 WRX, 3" turbo-back | freesound.org/people/ulose2piranha/sounds/273334 | ca7397e21735017b |
| K20 | 2012 Civic, field | freesound.org/people/thepodcastdoctor/sounds/487553 | 2887403c4f76019c |
| Merlin | static display run | freesound.org/people/squashy555/sounds/276597 | 866d1c76236f2381 |
| Aircooled | Porsche 911, field | freesound.org/people/mharo/sounds/55727 | 2387d2c74a32f3bd |
| CP3 | Yamaha MT-09, field | freesound.org/people/richwise/sounds/429491 | f96a60bd6cacbe83 |
| Radial | vintage radial biplane | freesound.org/people/craigsmith/sounds/437726 | a2ed9f4e8c301dcf |

The network policy of the development container blocked freesound.org and its CDN, so these clips have not been fetched or analysed. Once the host is allowed, the next step is to run the order analysis below on each clip and compare it with the matching reference engine.

### Analysis tools

* [rdoerfler/engine-order-analysis](https://github.com/rdoerfler/engine-order-analysis) implements angle-domain resampling and per-order magnitude and deviation extraction (Doerfler & Wyse, EUSIPCO 2026). This is the method for comparing order spectra between recordings and renders.
* [rdoerfler/ptr-model-page](https://github.com/rdoerfler/ptr-model-page) holds procedural engine-sound examples and spectrograms from the same authors.

## 4. Validation results

### Simulated dyno against published figures

Brake output after 2.5–3 s at the stated speed, WOT. Run with `scratchpad`-style scripts and pinned by `shared/ess/ess.test.ts`.

| Engine | Published | v16 | Error |
|---|---|---|---|
| GM LS3 | 575 N·m @ 4600 | 601 | +5 % |
| GM LS3 | 321 kW @ 5900 | 301 | −6 % |
| Ferrari F136 | 540 N·m @ 6000 | 499 | −8 % |
| Ferrari F136 | 425 kW @ 9000 | 369 | −13 % |
| BMW S54 | 365 N·m @ 4900 | 332 | −9 % |
| BMW S54 | 252 kW @ 7900 | 222 | −12 % |
| Honda K20A | 206 N·m @ 7000 | 202 | −2 % |
| Honda K20A | 162 kW @ 8000 | 142 | −12 % |
| Porsche 9A1 | 420 N·m @ 4400 | 407 | −3 % |
| Porsche 9A1 | 283 kW @ 6500 | 280 | −1 % |
| Lexus 1LR-GUE | 480 N·m @ 6800 | 507 | +6 % |
| Lexus 1LR-GUE | 412 kW @ 8700 | 399 | −3 % |
| Ferrari F140 | 690 N·m @ 6000 | 696 | +1 % |
| Ferrari F140 | 545 kW @ 8250 | 535 | −2 % |
| Audi EA855 | 480 N·m @ 2000 | 447 (steady, after ~4 s of spool) | −7 % |
| Audi EA855 | 294 kW @ 6000 | 313 | +6 % |
| Nissan VR38 | 632 N·m @ 3300 | 629 | −1 % |
| Nissan VR38 | 419 kW @ 6800 | 455 | +9 % |
| Bugatti W16 | 1250 N·m @ 2200 | 1307 | +5 % |
| Bugatti W16 | 736 kW @ 6000 | 842 | +14 % |
| SRT Hellcat | 881 N·m @ 4000 | 963 | +9 % |
| SRT Hellcat | 527 kW @ 6000 | 578 | +10 % |

The pattern: high-revving NA engines read 10–13 % low at peak power. Their real heads and intakes (ITBs, tuned airboxes, large valves) breathe better at high speed than the family defaults used for the unpublished parts. Boosted engines read 5–14 % high at peak power. Boost there is an estimate, and production engines also cap torque through the ECU, which v16 does not model.

### Idle

All 29 engines (8 factory presets plus 21 references) settle within about 5 % of target. The 0.5 s mean speed holds a standard deviation of 18–70 rpm on multi-cylinder engines. Two groups swing more:
* small-inertia motorcycle engines (CP3 about 200 rpm, Ducati about 125 rpm);
* the race-cam flat-6 (about 120 rpm).

### Engine-bay perspective against HL-CEAD

No-load steady speed (dyno with pedal trimmed for zero absorber torque), engine-bay listener, same statistics as the corpus:

| Render | Centroid (Hz) | 2–8 kHz % | Flatness | Order-locked % | Crest |
|---|---|---|---|---|---|
| 1.6 L i4, 1000 rpm | 3259 | 75 | 0.31 | 38 | 8.1 |
| 1.6 L i4, 1500 rpm | 3306 | 76 | 0.30 | 25 | 6.5 |
| 1.6 L i4, 2000 rpm | 3003 | 67 | 0.27 | 34 | 6.7 |
| 1.0 L i3 turbo, 1500 rpm | 2844 | 60 | 0.40 | 24 | 4.9 |
| HL-CEAD p50 (1000 / 1500 / 2000) | 3541 / 3303 / 3312 | 62 / 63 / 63 | 0.35 / 0.35 / 0.33 | 40 / 27 / 23 | 6.2 / 5.5 / 4.8 |

Every render falls inside the corpus p10–p90 ranges for flatness (0.26–0.40) and crest factor (5.0–8.9).

### Real recordings: engine-order comparison

The 10 CC0 recordings (section 3) are in `reference-audio/`, verified against their checksums
(`scripts/fetchReferenceAudio.py`). `scripts/compareRecording.py` tracks speed from the audio,
resamples to the crank-angle domain and compares order profiles (each order's level relative to
the frame total) against a render of the matching reference engine made by
`scripts/renderForCompare.ts` at the same operating condition.

| Recording | Segment | Result |
|---|---|---|
| 2JZ dyno (`2jz-supra-dyno.ogg`) | 11–25.5 s full-load pull, 3000→8150 rpm | Mean order-profile error 4.9 dB over 3200–6700 rpm, profile correlation 0.7–0.86, top orders 3/6/9 on both above 5000 rpm. Recording carries 10–15 dB more energy between orders below 4000 rpm (dyno cell, turbo flow noise) and less order 1.5 (the simulated two 3-1 collectors vs a likely 6-1 manifold). |
| LS3 idle | 0.2–2 s, 1032 rpm | 9.6 dB. The recording is an unidentified V8 with strong 3.5/4.5 sidebands (aftermarket cam lope); not a stock LS3. |
| EJ25 idle | 0.5–7 s, 725 rpm | 6.5 dB. Order assignment uncertain without a tachometer. |
| Harley idle | 1–17 s, 1012 rpm | 6.0 dB. Order assignment uncertain. |
| K20 cold idle | 4–9.5 s, 1531 rpm | Not comparable: an accessory tone near order 22 dominates the recording. |

What the comparison changed: the exterior listener's ground reflection was fully coherent at all
frequencies, cutting an 18 dB notch at order 12 of the 2JZ that no field recording shows. The
image path now stays coherent only below ~600 Hz (finite ground impedance, turbulence, source
extent; Daigle 1979, Embleton 1996), which took the 2JZ order-profile error from 7.6 to 4.9 dB.

Speed tracking without a tachometer is reliable for slow sweeps and steady segments (≈1 % on
known renders); fast free-revs and pass-bys (Doppler) need a speed hint or a vehicle model.

### Random configurations and real-time cost

`scripts/fuzzConfigs.ts` (library `shared/ess/fuzz.ts`) draws configurations across layouts,
1–16 cylinders, 0.1–1.4 L per cylinder, 3500–16000 rpm redlines, every aspiration and random
physical overrides. For each one it checks four things: idle (no stall, no runaway, finite output),
a WOT dyno hold at 0.7 × redline with positive brake torque, overrun, and a free rev against the
limiter. **80 of 80 seeds pass.** Seeds 3, 17 and 34 run in the unit tests.

Measured cost per engine, as a real-time factor at 48 kHz on a single vCPU of the build machine:

| Engine | Cylinders | Ducts | Real-time factor |
|---|---|---|---|
| Ducati 1299 | 2 | 14 | 0.24 |
| Honda K20A | 4 | 22 | 0.40 |
| GM LS3 | 8 | 42 | 0.71 |
| Ferrari F140 | 12 | 40 | 0.83 |
| Merlin V12 (supercharged) | 12 | 28 | 0.96 |
| Bugatti W16 (quad turbo) | 16 | 56 | 1.22 → 0.81 at the 2/3 tier |

### Wave physics (from the core build)

* Duct resonances fall within about 1 % of `nc/2L`.
* A Helmholtz test volume rings at 103 Hz against 102.3 Hz in theory.
* Single-cylinder WOT: VE 88–95 %, IMEP 11.8 bar, peak pressure 73–77 bar.
* Mass balance closes across throttle, valves and exhaust.

## 5. Other projects reviewed

| Project | Licence | What it offered |
|---|---|---|
| [ange-yaghi/engine-sim](https://github.com/ange-yaghi/engine-sim) | MIT | 0D cylinder plus 1-D exhaust reference; harmonic lobe; engine definitions |
| [Engine-Simulator/engine-sim-community-edition](https://github.com/Engine-Simulator/engine-sim-community-edition) | MIT | Maintained fork |
| [zolaski333/EngineLab](https://github.com/zolaski333/EngineLab) | MIT | Part libraries (cams, flow-bench Cd) and the CC0 audio manifest |
| [rdoerfler/engine-order-analysis](https://github.com/rdoerfler/engine-order-analysis) | see repo | Order-analysis method for validation |
| OpenWAM (CMT-UPV) | GPL | 1-D gas-dynamics reference, consulted only (licence incompatible with copying code) |
| [VinZu17/Engine-Sound-Simulator](https://github.com/VinZu17/Engine-Sound-Simulator), [antonio-r1/engine-sound-generator](https://github.com/antonio-r1/engine-sound-generator), [YigitSalihEmecen/Engine_Sim](https://github.com/YigitSalihEmecen/Engine_Sim), [mnursey/Real-Time-Car-Audio-Emitter](https://github.com/mnursey/Real-Time-Car-Audio-Emitter) | MIT / various | Browser and sample-based approaches; no physics reused |

## 6. Blocked sources

The development container's network policy denied wikipedia.org, upload.wikimedia.org, commons.wikimedia.org, zenodo.org, arxiv.org, kaggle.com, freesound.org (and cdn.freesound.org) and huggingface.co. Published figures were therefore taken from manufacturer documentation as widely reproduced. The CC0 recordings above are pending for the same reason.
