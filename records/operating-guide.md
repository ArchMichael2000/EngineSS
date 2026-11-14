# Operating guide

## Objective and authority

Develop a physically grounded engine sound simulator that is realistic across real and plausible configurations. The immediate assignment is to establish a current-versus-desired capability map and a reusable, economical team structure. The owner authorized additional contractor workers as needed and requested project-local records that can be kept on GitHub. This does not authorize unattended monitoring, deployment, or a new top-level chat by itself.

Use current code and reproducible measurements as primary evidence, then current test results, sourced reference data, and dated handoffs. Owner feedback determines whether audible and interactive behavior meets the intended experience. Reconcile discrepancies explicitly. Do not treat an old handoff, a model catalog, or a worker's assertion as proof of present behavior or execution.

## Role roster

These are assignments of responsibility, not claims that agents are continuously running. PM owns the register, integration, and user communication. Software architects define interfaces, experiments and tradeoffs; use the owner's preferred architect models when available. Coding specialists implement bounded changes and report verification. Compact context workers prepare focused packets and index evidence. Combine roles when separate agents add overhead.

| Discipline | Responsibility |
| --- | --- |
| Program management and knowledge | Scope, priority, ownership, decisions, evidence index and compact handoffs |
| Software architecture | Model boundaries, integration, invariants, experiment design and acceptance |
| Combustion and thermodynamics | Cylinder, valve and port flow, heat transfer, knock, idle and torque validation |
| Gas exchange and acoustics | Intake, exhaust, waveguides, forced induction, structure-borne sound and observer |
| Engine geometry and families | Firing, kinematics, X and radial layouts, two-stroke, diesel and rotary distinctions |
| Audio and visual evidence | Ingest available sound and visual evidence, compare recordings and simulations, document chain and limitations |
| Signal analysis | Independent reading of spectra, orders, time histories and measurement validity |
| Controls and vehicle | ECU, limiters, drivetrain, starting and transient behavior |
| Real-time and product | Worklet, performance, UI, browser behavior, export and accessibility |
| Verification and references | Reproducible tests, fuzzing, reference provenance and cross-family regression |

The owner designated Argon for sound and visual ingestion, with one Opus and one Terra graph analyst; a second Terra is the authorized substitute if Opus is unavailable. Fable and Sol are preferred software architects; Opus and Terra are preferred coders. Specific runtime model configuration and execution evidence belong in session records, consistent with `docs/HANDOFF.md`'s instruction not to put model identifiers in repository content. A designated role is not evidence that its runtime can ingest live media: verify the actual input path before claiming it works.

## Dispatch and evidence

Start with one accountable owner and a narrow deliverable. Delegate only work that benefits from a separate context or specialist, and give each worker the minimum relevant paths, baseline, acceptance checks and exclusive write scope. Workers preserve evidence; leads reconcile it; PM accepts results. Use `ready`, `assigned`, `accepted`, `working`, `pending verification`, `completed`, `blocked`, or `superseded`. Record execution and quota as observed, not inferred from a catalog. Preserve partial work on failure; use only the owner's stated fallback or ask when another substitution matters.

Keep one writer for each shared record, coordinate overlapping code paths, and run dependent work sequentially. Save compact findings and source pointers here rather than transcripts. Run checks proportional to each change and the full suite before pushes as required by the technical handoff; run the documented fuzz sweep for combustion, friction or idle changes. Compare audio with known recording limitations and retain listening feedback alongside numeric metrics. Investigate sample-rate and multi-seed stability for idle changes. Profile allocations when changing the audio loop.

Owner decisions and permissions apply as stated in the current session. Follow the repository's current branch and PR conventions; verify the current state rather than assuming a historical instruction remains current. Do not publish or claim synchronization before it occurs. Reporting is on request or at meaningful checkpoints; no scheduler or continuous monitoring has been configured.
