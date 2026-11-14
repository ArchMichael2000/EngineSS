# Capability map and priorities

Baseline `d19157e`, 2026-11-14. This is an initial map from repository documentation and a read-only investigation, not a fresh test run. Quantities are reported historical measurements, not independently reproduced here. Priorities are working triage, not owner-approved implementation commitments.

| Area | Current capability | Desired capability and gap | Priority |
| --- | --- | --- | --- |
| Realism and references | Physical cylinder, gas-path, structure and observer models; reference engines and recording-comparison scripts | Credible sound across real and plausible configurations, with identified, calibrated recordings and repeatable listening plus measurement | 1 |
| Two-stroke | Ports, crankcase, expansion chamber and reference examples | Light-rev high-frequency deficit reported at 12–17 dB; CRM250 torque and power reported 24% and 26% low. Diagnose missing plugging pulse before tuning | 1 |
| Structure and manifold | Structure-borne radiation and exhaust grouping | Validate level versus speed with calibrated recordings; investigate inter-order energy and manifold geometry without repeating rejected overshooting model | 1 |
| Stability and output | Idle feedback, multiple limiters, output leveler and worklet adaptation | Preserve stable, audible behavior across seeds, sample rates and families; investigate documented capture anomalies and level differences | 1 |
| Diesel and rotary | Diesel injection and variable turbine geometry; rotary chamber and port models | Prechamber diesels, additional diesel transients and mechanical sounds; open rotary recordings and further reference engines | 2 |
| Geometry and configuration | Inline, V, flat, W, radial and X; up to 24 piston cylinders; firing and rod kinematics | Continue cross-family validation and support application-specific inertia, gearing and listener positions for X engines | 2 |
| Real-time and interaction | Worklet rate tiers, engine visualization, drive controls and offline audio export | Maintain responsiveness and sound quality as configurations grow; remaining optimizations require measurement and may need architectural changes | 2 |
| Forced induction and controls | Turbo, several supercharger types, variable turbine geometry, drivetrain and limiter choices | Deeper surge characterization, staging and anti-lag where justified by evidence | 3 |
| Product persistence | Local browser storage is used by the shipped client | Confirm intended sharing and backend behavior with the owner before treating local gallery functionality as a server-backed service | Open decision |

## Lessons that constrain future work

- A single idle snapshot missed intermittent stalls. Inspect at least eight seconds of half-second means, multiple seeds and 48 kHz, alongside other relevant rates.
- Better numerical limiter behavior once sounded muted to the owner; compare measurements with listening and preserve selectable behavior.
- Per-sample clipping caused high-rpm drone; a valve solver root caused vacuum spikes; orphaned worklet nodes doubled CPU. Protect the relevant regressions.
- A timing-chain tone masked missing two-stroke high orders. Removing a physically incorrect source may worsen a score while revealing a real gap.
- Match recording-chain filtering, particularly low-frequency roll-off, and do not treat the best listener position as model validation. Combustion variability makes sample-by-sample null tests unsuitable.
- Audio-loop allocation and sample rate matter. Use the documented allocation profiler and full-suite-before-push convention in [the handoff](../docs/HANDOFF.md).

## Evidence and open questions

Detailed model measurements and citations: [reference sources](../docs/reference-sources.md); browser captures and unexplained anomalies: [browser verification](../docs/browser-verification.md); technical state and open work: [handoff](../docs/HANDOFF.md). The handoff's working-branch statement and historical reference counts require reconciliation against the current tree. The old `todo.md` is a historical checklist, not the current roadmap. Confirm live-site behavior, exact reference count, current test results, backend/export behavior and actual media-ingestion support before relying on them.
