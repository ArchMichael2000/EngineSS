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
| Diesel ignition delay | Hardenberg–Hase `τ[°CA] = (0.36 + 0.22·Sp)·exp(Ea(1/R̃T − 1/17190) + (21.2/(p − 12.4))^0.63)`, `Ea = 618840/(CN + 25)` | Hardenberg & Hase, SAE 790493 | `cylinder.ts` `inject` |
| Diesel heat release | Double Wiebe: premixed share `β = 1 − 0.926·φ^0.37/τ_ms^0.26` (≈ 0.7 ms spike), mixing-controlled remainder (25–110°) | Watson, Pilley & Marzouk, SAE 800029; Miyamoto et al., SAE 850107 | `cylinder.ts` |
| Diesel combustion noise | Premixed spike rings the chamber's first circumferential mode, at 6 % of its constant-volume pressure rise (×2 when it burns in < 5°); pilot injection shortens the main delay to 30 % and halves β | Russell & Haworth, SAE 850973 (combustion noise and pressure-rise rate) | `cylinder.ts` `startRinging` |
| Two-stroke ports | Piston-uncovered exhaust and transfer ports (width × uncovered height, 2 mm corner radius, Cd 0.72); reed valve (one-way, 0.5/0.25 ms petal lag) or piston-port induction into a crankcase pump | Blair, *Design and Simulation of Two-Stroke Engines* (SAE, 1996), ch. 2–3, 6 | `cylinder.ts` `portArea`, `transferFlow`, `stepCrankcase` |
| Two-stroke scavenging | Outflow burned share 1 − (1 − b)^q (q 1 = perfect mixing, 1.8 loop default); fresh and burned zones keep their own temperatures in the outflow enthalpy; a header-sized slug returns short-circuited charge on backflow (pipe plugging) | Benson & Brandham (1969) mixing model; Blair's two-zone scavenging | `cylinder.ts` |
| Expansion chamber | Header 0.30·L_t, diffuser 0.40 to a belly 3.1× header, belly 0.12, baffle 0.36 to a stinger 0.62×, stinger 0.30, cones as stepped ducts; L_t = c·(θ_exh − 40°)/(12·N), c ≈ 500 m/s | Blair (1996) ch. 5; Jennings, *Two-Stroke Tuner's Handbook* | `exhaust.ts`, `resolveSpec.ts` |
| Wankel chamber | V = V_min + (V_d/2)(1 − cos(2θ/3)), V_d = 3√3·e·R·b; torque p·dV/dθ on the e-shaft; 1080° face cycle, faces 360° apart, rotors 360/n apart | Yamamoto, *Rotary Engine* (Toyo Kogyo/Mazda, 1981); Ansdale, *The Wankel RC Engine* (1968) | `cylinder.ts` `chamber`, `geometry.ts` `rotarySchedule` |
| Wankel ports | Apex-seal-swept port areas with raised-cosine ramps (peripheral ≈ 30°, side ≈ 100°); 13B-REW timing (intake 32° ATDC–50° ABDC, exhaust 75° BBDC–48° ATDC) with street, bridge and peripheral porting presets; faces share each rotor's runner and exhaust port | Mazda 13B service data; porting practice | `cylinder.ts` `rotaryPort`, `intake.ts` |
| Wankel heat transfer | Wall area 2V/b + 2√3·R·b (side housings, rotor flank, trochoid housing over the apex chord); Woschni velocity from the rotor apex speed R·ω/3 | Geometry; Woschni (1967) | `cylinder.ts` |
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
| Vehicle drivetrain | 6-speed; top gear puts the lower of redline and rev limiter at the power-limited top speed, (½ρ·C_d·A·v² + m·g·C_rr)·v = 0.9 × estimated peak power (85 % of the BMEP torque guess at 85 % of top speed; 12 bar four-stroke, 8 bar firing every revolution for two-strokes); shifts at 96 % of the same speed. Cars 950 + 150·L kg, C_d·A 0.65, C_rr 0.012; bikes (≤ 2 cylinders or ≥ 10 000 rpm) 110 + 90·L kg + 80 kg rider, C_d·A 0.5. Torsional spring-damper driveline (≈5 Hz shuffle, ζ 0.3) in series with a stick–slip clutch (1.8× / 2.2× peak torque) | 0–100 km/h: LS3 car 4.1 s (published 4.6–4.9), K20A 5.8 (Civic Type R 6.6), S54 4.6 (E46 M3 5.1), RD350LC 5.7 (≈ 5–5.5), Harley M8 3.9 (≈ 4–4.5), Ducati 1299 2.3 (≈ 2.5). Every reference engine completes the run (`scripts/driveSurvey.ts`). |
| Shift and launch control | Automated clutch: torque-based launch (clutch torque = engine torque + J·12·Δω about a pedal-dependent launch speed); upshift = 40 ms clutch open + ignition cut held until 70 % re-engagement (flat shift) + 60 ms select + 120 ms engage; downshifts blip to rev-match | Sequential/DCT behaviour. Ignition cuts send charge into the exhaust, so flat shifts and launch control produce afterfire. |
| Start / stop | Starter torque (40 + 32·L) N·m falling to zero at 320 crank rpm; catch above 55 % of idle; start flare +30 % decaying over 1.5 s; starter mesh (132 ring teeth) and commutator whine through the block | Cranking settles at 190–260 rpm; catch at about 0.3 s; idle reached in about 2 s. |
| Plenum port loss | K 0.08 entering a runner, 0.9 leaving one | Radiused entry vs Borda–Carnot expansion (Idelchik). Brings the LS3 tuning trough to a realistic depth (VE 83 % at 5900 rpm). |
| Turbine area | 0.126 mm² per litre·rpm at threshold speed (small 0.22, balanced 0.32, large 0.45 × redline) | Energy balance with η_t 0.68, T3 ≈ 1100 K, PR_t ≈ 0.75·PR_c. |
| Compressor map | φ peak 0.04, design 0.09, choke 0.165; ψmax 0.56 | Exducer-based flow coefficient of modern ported-shroud stages. |
| Compressor wheel | Redline flow at φ 0.12, 470 m/s tip speed | Puts the WOT operating line right of peak efficiency and short of choke. |
| Idle feed-forward | Energy balance: friction + accessories + pumping at η 0.27/(1 + overlap/30) | Lands within about 10 % of the converged idle-valve opening on all 29 engines. |
| Accessory drag | (2.6 + 0.00035·rpm) · L | About 16 N·m on a 6 L V8 at idle, about 3 N·m on a 1 L motorcycle engine. |
| Structure excitation | Combustion F = A·p; piston slap J = m·√(2Fc/m) with 30 µm clearance; valve seating J = 0.05 kg × 0.25 m/s·(rpm/6000); timing drive 60 N noise + 36 N mesh tone (order 21) × (rpm/1000)^1.5 on four-strokes; two-strokes (no camshaft drive, no valvetrain) keep half the noise and no tooth tone; Wankels 0.6 × with the stationary-gear mesh at ≈ 34 per e-shaft revolution | Physical impulse magnitudes. The order-21 tone on two-strokes was a bug found by the CRM250 recording (§4). Contact durations 100 µs (seat), 0.3 ms (slap), 150 µs (chain). |
| Structure radiation | 22 block modes (450–5200 Hz) and 16 head modes (1.5–6 kHz) scaled by size^−0.28; head/block mobility 0.8; 2nd-order radiation-efficiency high-pass at 2.4 kHz (below coincidence) | Fitted to HL-CEAD engine-bay statistics: 1.6 L i4 at 1500 rpm gives centroid 3.3 kHz (3.30), 2–8 kHz 62–76 % (63), flatness 0.30 (0.35), order-locked 25 % (27), crest 6.5 (5.5). Measured with `scripts/analyzeReferenceCorpus.py`'s own statistics. |
| Cabin boom gain | 0.00175 Pa per N·m of 25–180 Hz torque ripple | **Unverified.** No open interior recordings; set so WOT boom sits a few dB above the airborne exhaust. |
| Afterfire | Continuous afterburning (τ ≈ 3 ms when hot with O₂) while firing; discrete pops need fuel cut, limiter cut or misfires | Matches observed behaviour: crackle on lift-off and the limiter, flame without pops under load. |
| Variable-geometry turbine | Full-open nozzle sized like a large housing (0.55 × redline in the area rule), closed vanes 30 % of it; vanes on the wastegate's PI with the same anticipation, opened by shaft overspeed; no wastegate. Default for boosted diesels with pilot injection (common rail), set per engine otherwise | PSA 1.5 BlueHDi torque at 1750 rpm: −27.5 % with a wastegate, −8.5 % with the VGT (`docs/figures/diesel-vgt.png`). |
| Surge duct | Greitzer inertance 1.8 m / inducer area (inlet → compressor → charge piping → throttle) | Sets the charge-system Helmholtz frequency near 20–35 Hz. Deep surge without a BOV then runs at 32 Hz on the 2JZ (96 % of Helmholtz). The OSU rig (Dehner & Selamet) measured 63–82 % of Helmholtz, so the simulated cycle sits closer to the mild-surge rate. The previous 0.6 m duct gave 70 Hz with no flow reversal. Sensitivity (October 2026): the frequency follows the Helmholtz frequency for any duct inertance (0.6–1.8 m) and ignores the backflow-branch slope (1–25·φ²): the cycle stays the mild type. Lowering the shut-off head ψ₀ from 0.42 to 0.30 / 0.20 gives 90 % / 85 %. Reaching the measured band needs the stage's measured negative-flow characteristic, which is not available. |
| Blow-off valve | Pneumatic: cracks at 20 kPa across the throttle, fully open at 40 kPa, 12 ms travel; area 0.16·D²·count (≈ 0.45 × wheel diameter) | A fixed 24 mm valve on an 83 mm wheel balanced the wheel's flow at 220 kPa. Sized to the wheel, the compressor stays out of surge and boost halves in 250 ms, then decays with shaft speed. |
| Wastegate | PI on boost; proportional term on boost predicted 0.15 s ahead from its filtered rise rate | Tip-in overshoot 10.5 % (17 % without anticipation); settled boost within 1.5 % of target. |
| Diesel governor | All-speed: fuel per stroke = pedal^1.15 × full-load fuel over an idle PI (no derivative: diesel speed ripple turns it bang-bang); droop to zero fuel over the last 180 rpm; full-load fuel tapers 12 % from 0.6 × redline (torque rise); main injection advances 1.5°/1000 rpm to 9° (turbo, pilot) or 12° (NA) BTDC at redline | Fuel per stroke defaults to the smoke limit λ 1.4 (turbo) / 1.5 (NA) at rated boost; mechanical-pump engines take their fuel-plate value from published BMEP. EA288 peak pressure ≈ 190 bar at 2500 rpm full load. |
| Diesel injector spread | Fixed per-injector delivery offset, 1σ 0.5 mg/stroke (mechanical pumps) or 0.12 mg (common rail, pilot injection), × 2·build tolerance | **Estimated.** In-line and distributor pumps are calibrated to roughly ±1 mm³/stroke between elements at idle delivery; common-rail ECUs trim per-cylinder quantities at idle from crank-speed ripple (smooth-running control). The scatter is absolute, so it matters most at idle. On the Cummins idle it raises the off-firing order share by 0.6 dB (§4). |
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

### EngineLab CC0 corpus (10 recordings downloaded to `reference-audio/`)

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

All ten are fetched and checksum-verified by `scripts/fetchReferenceAudio.py`; §4 has the comparisons.

### Diesel, two-stroke and cabin recordings (October 2026)

Found on freesound.org with `scripts/searchFreesound.py` (public pages and previews, no API key) and added to the manifest with checksums and attribution (`reference-audio/ATTRIBUTION.md`). Only CC0 and CC-BY files are committed.

| Key | Recording | Licence | Reference engine |
|---|---|---|---|
| PSA-BlueHDi | 2022 Peugeot 3008 1.5 BlueHDi: idle, free revs to the 4000 rpm neutral limit (phone) | CC0 | psa-dv5-bluehdi |
| VW-ALH | VW New Beetle 1.9 TDI: start, idle, revs (phone) | CC0 | vw-alh-tdi |
| Octavia-TDI | Early-2000s Skoda Octavia 1.9 TDI idle, ~10 m (phone) | CC0 | vw-alh-tdi |
| 190D | Mercedes 190 D: idle, revs (2.0 OM601 assumed; 2.5 five-cylinder not excluded) | CC0 | mercedes-om601 |
| OM636 | Mercedes 180 D OM636 marine conversion, rpm ramps | CC-BY 3.0 | (none) |
| Cummins-5.9 | Ram 3500 5.9 Cummins start and idle (phone) | CC0 | cummins-6bt |
| CRM250 | Honda CRM250 two-stroke: kick start, free revs | CC-BY 4.0 | honda-crm250 |
| CRM250-onboard | Honda CRM250 onboard pull-away | CC0 | honda-crm250 |
| MZ-ETZ250 | MZ ETZ 250 two-stroke: start, revs | CC-BY 4.0 | mz-etz250 |
| FA20-Vortech | GT86 / BRZ / FR-S with a Vortech centrifugal supercharger on a chassis dyno, 4th-gear pull 3000→7200 rpm (exhaust, engine and interior microphones mixed) | CC-BY 4.0 | toyota-fa20-vortech |
| CX9-cabin, diesel-cabin, cabin-accel, cabin-idle-fast | Interior recordings, driving and accelerating (cars or engines not stated) | CC0 / CC-BY 3.0 | (none) |

**No open-licensed Wankel recording was found.** Freesound has one (Sampling+, an unidentified rotary race car), which is listed under `local_only` and never committed. Wikimedia Commons and the Internet Archive returned nothing usable, and the RX-7 libraries that exist are commercial.

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
| Yamaha RD350LC (two-stroke) | 40 N·m @ 8000 | 39 | −3 % |
| Yamaha RD350LC (two-stroke) | 34.6 kW @ 8500 | 33 | −5.5 % |
| Mazda 13B (FC S5 NA rotary) | 187 N·m @ 4000 | 181 | −3 % |
| Mazda 13B (FC S5 NA rotary) | 118 kW @ 7000 | 131 | +11 % |
| VW EA288 2.0 TDI | 340 N·m @ 1750–3000 | 327 | −4 % (VGT) |
| VW EA288 2.0 TDI | 110 kW @ 3500–4000 | 119 | +8 % (VGT) |
| Cummins 6BT 5.9 12V | 542 N·m @ 1600 | 580 | +7 % |
| Cummins 6BT 5.9 12V | 119 kW @ 2500 | 120 | +1 % |
| PSA DV5 1.5 BlueHDi | 300 N·m @ 1750 | 274 | −8.5 % (VGT; −27.5 % with the former wastegate turbo) |
| PSA DV5 1.5 BlueHDi | 96 kW @ 3750 | 101 | +5 % |
| VW 1.9 TDI ALH | 210 N·m @ 1900 | 207 | −1 % (fuel limit fitted: 34 mg; VNT-15 VGT) |
| VW 1.9 TDI ALH | 66 kW @ 4000 | 72 | +9 % |
| Mercedes OM601 2.0 | 123 N·m @ 2800 | 131 | +7 % |
| Mercedes OM601 2.0 | 53 kW @ 4600 | 50 | −6 % |
| Honda CRM250 (two-stroke) | 36 N·m @ 7000 | 25 | −30 % |
| Honda CRM250 (two-stroke) | 29.4 kW @ 8000 | 19 | −35 % |
| MZ ETZ 250 (two-stroke) | 27.5 N·m @ 5200 | 24 | −12 % |
| MZ ETZ 250 (two-stroke) | 15.4 kW @ 5500 | 14 | −8 % |

EA288 full-load brake efficiency at 2000 rpm is 0.42 (published TDI peak ≈ 0.42, BSFC ≈ 200 g/kWh).
At idle its ignition delay is 4.1° without pilot (premixed share 0.60) and 1.5° with it (0.24), and
pilot injection lowers 1–4 kHz structure-borne combustion noise by about 5 dB. With pilot the
diesel is still about 10 dB above a gasoline engine of the same size at idle.

The five engines added in October 2026 (`scripts/dynoCheck.ts`) are not pinned by the tests yet: the PSA's low-end torque and the CRM250 are open model gaps (VGT, two-stroke power valve and high specific output, 118 hp/L against the RD350LC's 100).

**S54 at 7900 rpm (October 2026).** The code at handoff gives 174 kW (−31 %), not the 222 kW tabled above. The cause is the measurement: the soft limiter starts cutting at 7970 rpm, the dyno absorber's speed swings to 8044 rpm under the cuts, and the cut cycles show in the sampled IMEP. With the limiter moved to 8500 rpm the speed holds within ±25 rpm and the S54 makes 215 kW (−15 %). The deficit pattern holds across the three engines: F136 −12.5 % at 9000 rpm, S54 −15 % at 7900, K20A −8.6 % at 8000, against −2 % for the F140 at 8250 and −6 % for the LS3 at 5900. It appears only above about 21 m/s mean piston speed. Volumetric efficiency there is 87–93 %. The speed-squared terms are the candidates: the Chen–Flynn Q·Sp² friction (0.9 bar at 24 m/s) and the accessory drag, whose rpm-linear torque takes 14.5 kW on the S54 at 7900 rpm and may double-count the oil and water pumps already in a motoring-calibrated friction figure. Neither has been changed without friction data to fit.

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

### New families against real recordings (October 2026)

`scripts/compareCorpus.py` runs every case in `shared/ess/reference/recording-comparisons.json`: it analyses the recording, renders the matching reference engine at the same condition (a steady idle, or a *replay* along the recording's own tracked speed for free revs) from each listener perspective, and compares. The microphone position of hobby recordings is unknown, so every perspective is reported. The best one says where the microphone probably was; it does not by itself say the model is right.

Two measurement fixes came first. A phone microphone rolls off steeply below about 100 Hz, so a 27 Hz firing order present in the render and absent in the recording swamped every frame-relative order level (PSA idle: 23–35 dB "error"). Both sides now pass the same high-pass (`--highpass`: 100 Hz where the uploader says it was a phone, 40 Hz otherwise). Second, the order profile only reaches order 32, a few hundred hertz at idle, so a broadband tilt (energy 2–8 kHz over 0.1–1 kHz) is reported alongside.

| Case | Mode | Order-profile error, rear / side / **engine bay** (dB) | Off-firing share at engine bay, rec / sim (dB) | Tilt, rec / sim rear … engine bay (dB) |
|---|---|---|---|---|
| cummins-5.9-idle | idle | 18.3 / 10.3 / **7.0** | -4.4 / -3.2 | -7.5 / -24.0 … 12.3 |
| psa-bluehdi-idle | idle | 25.3 / 14.9 / **6.4** | -4.0 / -1.2 | -8.8 / -30.0 … 8.9 |
| psa-bluehdi-revs | replay | 7.5 / 7.3 / **5.9** | -4.6 / -2.1 | -7.1 / -17.3 … 14.6 |
| skoda-tdi-idle | idle | 25.6 / 13.7 / **5.9** | -2.4 / -3.0 | -9.1 / -31.5 … 11.9 |
| beetle-tdi-idle | idle | 25.6 / 13.8 / **9.0** | -1.4 / -3.0 | -18.1 / -31.5 … 11.9 |
| beetle-tdi-revs | replay | 9.8 / 7.7 / **5.7** | -4.6 / -2.7 | -14.0 / -16.7 … 12.6 |
| mercedes-190d-revs | replay | 28.8 / 21.6 / **15.5** | -9.5 / -24.1 | -13.4 / -43.7 … -10.4 |
| crm250-revs | replay | 18.5 / 16.7 / **13.7** | -5.8 / -12.6 | -0.8 / -25.3 … -14.2 |
| fa20-vortech-dyno-pull | replay (WOT) | 10.3 (rear) / 9.1 (dyno tailpipe) / **7.9** | -4.4 / -6.6 | -14.9 / -23.5 … -1.5 |
| mz-etz250-revs | replay | 14.4 / 14.7 / **12.7** | -5.6 / -10.6 | -0.6 / -30.1 … -17.0 |

What it shows:

* **Diesels match at 5.7–9 dB from the engine bay**, the position consistent with phone clips made next to the vehicle: Cummins idle 7.0, PSA idle 6.4 and revs 5.9, Octavia idle 5.9, Beetle idle 9.0 and revs 5.7 (the 2JZ dyno pull is 4.9). The recorded tilt (−7 to −18 dB) falls between the simulated exterior-side and rear values, so the microphones were probably a few metres away; whether the simulated clatter is too bright at the engine bay cannot be told from these clips.
* **An identified four-stroke under load:** the supercharged FA20 dyno pull matches at 7.9 dB (engine bay; the recording mixes three microphones). As with the diesels, the real engine carries more energy between the firing orders (−4.4 dB against −6.6 to −12.7).
* **The 190 D does not match (15.5 dB, off-firing share 15 dB low).** The real OM601 is a prechamber engine with a much softer, rougher burn, and the car may be the five-cylinder 2.5; the model injects directly.
* **Two-strokes are too dull at every perspective.** The recordings' tilt is about −1 dB; the renders are −14 to −30 dB, and the error is 12–14 dB. Soloing the stems on the CRM250 at 7000 rpm WOT (engine bay) gives intake −29 dB (tilt −16), exhaust −34 dB (tilt −9), structure −42 dB (tilt 0) and outlet jet −78 dB: the high-velocity stinger jet and the sharp port blowdown that make a two-stroke rasp are far too weak. This is the main open two-stroke sound gap.
* **Bug found: four-stroke timing-chain whine on two-strokes.** The structure model's order-21 timing-drive tone ran on every engine, and stood 15 dB above the CRM250 recording at order 21. Two-strokes now have no tooth tone and half the friction excitation (the engine-bay error rises from 11.2 to 13.7 dB, because the false tone had been filling the missing high orders).
* **Off-firing energy.** Measured from behind and before the high-pass was added, the Cummins idle had 11 dB more energy between the firing orders than the render (−8.2 against −19.2 dB). Adding the measured-scale injector spread (0.5 mg) moves it 0.6 dB; an end-collector log manifold overshoots (−1.7 dB against −8.2 dB). Real log-manifold geometry is the likely remaining cause and is not modelled.

Not compared: the Wankel (no open recording), the cabin clips (cars and engines not stated, uncalibrated levels, so the boom gain stays unverified) and the OM636 (no matching reference engine).

### Forced-induction acoustics

`scripts/verifyForcedInduction.ts` renders each event with only the accessory stem, on a dyno-held
crank, and checks it. **19 of 19 checks pass.**

| Check | Result | Expected |
|---|---|---|
| 2JZ shaft speed / tip speed at full boost | 113 krpm / 496 m/s | 90–220 krpm / 380–520 m/s (small automotive turbos; cast-wheel limit) |
| Blade-pass tone at shaft × blades | 0.5 % off, 33 dB prominent | < 1 % |
| BOV lift-off: minimum compressor flow | +0.15 kg/s (no surge) | > 0 |
| BOV lift-off: boost halved | 251 ms | 50–600 ms |
| BOV vent level / spectral centroid | +16 dB over post-vent / 1.0 kHz | broadband jet, 0.2·u/d |
| No-BOV lift-off: deep-surge reversals in 1.5 s | 48 at 31.6 Hz | 10–35 Hz (≈ 30 Hz measured on the OSU rig) |
| Wastegate tip-in overshoot / settled boost | 10.5 % / 101 % | ≤ 12 % / 90–106 % |
| Hellcat twin-screw rotor speed at 4000 rpm | 10.7 krpm | ≈ 2.4–2.7 × crank |
| Pocket tone at rotor × lobes / timing-gear mesh | 0.25 % off, 21 dB / 30 dB prominent | < 1 % |

Spectrograms of the four events: `docs/figures/forced-induction-events.png`. Steady-state output of
the boosted reference engines was unchanged by these fixes (within 0.3 %).

### Two-stroke: what it took to make the pipe work

Blair-style defaults (exhaust port at 87° ATDC on the RD350LC) first gave 16 kW at 8500 rpm. Each fix was found by tracing one cycle:

1. **Intake sized for a four-stroke.** A two-stroke inducts every revolution, so throttles are sized for twice the airflow, with a short carb-and-boot runner and no airbox resonator.
2. **Scavenging energy.** Outflow composition already favoured burned gas, but its enthalpy used the mixed temperature, so the trapped charge stayed too hot and thin. Splitting fresh and burned zones in the outflow added 20–25 % output.
3. **Pipe timing.** Blair's L_t = c·θ/(12N) returns a wave launched at port opening right at port closing. In the model the blowdown peaks ≈ 25° after opening, so the plug arrived after the port closed and the diffuser's suction landed at closing. Sizing from the actual wave timing, L_t = c·(θ − 40°)/(12N), put the plug before closing: the RD350LC went from 26 to 33 kW at 8500 rpm, and delivery ratio stays ≈ 0.95 through the top end.
4. **Mechanical friction.** With no valvetrain and rolling-element bearings, two-stroke friction is set to 0.65 × the four-stroke correlation.

**Torque curve (October 2026).** The RD350LC's full-load torque stays within 5 % of its peak from 4000 to 8500 rpm (`scripts/torqueCurve.ts`): delivery ratio ≈ 0.95 and trapping efficiency ≈ 0.55 at every speed. A piped engine's plugging pulse should lift trapping near the tuned speed only, giving the narrow power band; here it adds little trapping anywhere, and the pipe's benefit over a plain exhaust is the same at 4000 rpm as at 8000. Extra wave damping in the pipe (0–2 Np/m) changes nothing, so later reflections are not the cause. An exhaust power valve (YPVS, Honda RC) is not added yet: it would raise low-speed torque that is already too high. Fixing the trapping response comes first.

Result at 8000 rpm: the pipe adds more than 20 % over a plain exhaust (pinned by a test). Trapping efficiency 0.55 at delivery ratio 0.95. Idle runs on the residual-heavy, misfiring "four-stroking" regime the model produces on its own (residual ≈ 0.5 at idle). Idle air is metered by the slide's idle stop, with no four-stroke decel schedule or dashpot. 24 random two-strokes (singles to fours, reed and piston-port) all pass the fuzz checks.

### Rotary

The 13B fires every 180° of e-shaft (six chambers, two firings per revolution). It idles at 800–850 rpm, and exhaust gas runs at 790–870 °C at full load. Its torque curve is flatter than the real Series 5's at the top end (+11 % at 7000 rpm); the real engine's auxiliary-port switching is not modelled. Peripheral intake porting reproduces the known trade:

* manifold pressure at idle rises from about 30 to 98 kPa;
* residual gas at idle reaches 75 %, the rough "brap" idle;
* torque falls at 4000 rpm (138 against 181 N·m) and rises at the top end.

**+11 % at 7000 rpm (October 2026).** The cause is not the auxiliary ports: closed auxiliary ports would make a model without them weaker at the top, not stronger. Volumetric efficiency rises with speed, 79 % at 4000 rpm to 88 % at 7000, so torque stays flat (181 → 179 N·m) where the real engine falls 13 % (186 → 161). The stock exhaust with its catalyst takes off only 2 kW. Intake tuning is the remaining suspect.

**Mechanical noise.** Wankels no longer get the four-stroke timing-chain tone (order 21). Their structure is excited by the stationary-gear mesh: the rotor's internal gear rolls on the stationary gear, whose contact point circles it once per e-shaft revolution, so the tone sits at its tooth count, ≈ 34 per revolution on a 13B (tooth count estimated). Rendered on the 13B's structure stem at 3000 rpm it stands at order 33.98, 25 dB above the surrounding structure noise. Apex-seal crossings at port edges already excite the structure through the port-closing impulses.

24 random rotaries (1–4 rotors, NA, turbo and supercharged, peripheral and side ports) pass the fuzz checks.

Side-by-side render of the four families (idle, full-throttle rev, lift-off; exterior rear): `docs/figures/engine-families.png`.

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

**October 2026 re-measure** (`scripts/cpuBench.ts`, one thread of a 4-vCPU container, 1 s idle, 1 s free rev, then dyno at 0.8 × limiter): W16 1.24–1.35 (run-to-run spread), F140 0.89, LS3 0.67, EA288 0.49–0.55, 13B 0.47–0.48, RD350LC 0.39–0.41, K20A 0.38–0.40. The cost estimate is within 10 % except the two-stroke (0.32 estimated against 0.39–0.41 measured). In Chromium the same engines run with their worklet-measured load at 25–81 % of the audio thread, and the W16 at its 32 kHz tier (`docs/browser-verification.md`).

Profile of the W16 (Node `--cpu-prof`): duct sample reads 14 %, the per-sample engine loop 11 %, cylinder step 10 %, valve residuals and solver 16 %, junction solves 6 %, compressor 3 %. The valve solver averages 3.8 residual evaluations per solve (11.7 solves per sample on the W16) with its warm start, linear predictor and Newton first step. Stopping at 1e-4 of the flow instead of 1e-6 cut that to 3.2 but gave no measurable wall-clock gain, and it was reverted. Changes like this also cannot be checked sample by sample: the combustion variability makes the trajectory diverge after the first perturbed cycle (idle stays within −14 to −77 dB of the reference, then the signals decorrelate) while dyno torque moves less than 0.1 %. `scripts/nullTest.ts` and `scripts/nullCompare.py` report both. The remaining options are structural: thermodynamics at a sub-rate, or splitting the engine across threads. Threads need SharedArrayBuffer, which needs cross-origin isolation headers that GitHub Pages does not send.

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
