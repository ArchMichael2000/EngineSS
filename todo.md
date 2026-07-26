# Engine Sound Simulator - Project TODO

## Design & Setup
- [x] Cyberpunk design tokens (dark bg, neon pink/cyan, geometric sans-serif, glow effects)
- [x] HUD-style UI framework (thin lines, corner brackets, futuristic atmosphere)
- [x] Google Font integration (geometric sans-serif)
- [x] Database schema for engine configs, presets, community gallery

## Audio Engine Core
- [x] Web Audio API context management with seamless parameter transitions
- [x] Procedural combustion pulse synthesis driven by firing-order timing
- [x] Sample-based texture layers (intake roar, exhaust character, mechanical noise)
- [x] RPM-responsive audio without interruption on parameter changes
- [x] Throttle and load influence on sound character
- [x] Deterministic audio reproduction from saved configurations

## Quick Build Mode
- [x] Engine layout selector (inline/V/flat/W/radial)
- [x] Cylinder count selector (1-16)
- [x] Displacement control
- [x] Crankshaft character (cross-plane/flat-plane/even-fire/odd-fire)
- [x] Aspiration type (NA/turbo/supercharged)
- [x] Exhaust character control
- [x] Idle character control
- [x] Redline setting
- [x] Auto-selection of reasonable internal parameters

## Advanced Build Mode
- [x] Bore/stroke controls
- [x] Bank angle control
- [x] Firing order (presets + manual entry with validation)
- [x] Header geometry (equal/unequal length)
- [x] Exhaust routing (single/dual/open headers)
- [x] Intake type (single throttle body/ITBs/carb/velocity stacks/airbox)
- [x] Rev limiter type (soft/hard fuel cut/hard ignition cut)

## Forced Induction System
- [x] Naturally aspirated mode
- [x] Turbocharger (small/balanced/large/custom)
- [x] Turbo spool sound
- [x] Blow-off valve (BOV) sound
- [x] Wastegate sound
- [x] Supercharger (Roots/twin-screw/centrifugal)
- [x] Supercharger whine
- [x] Boost response affecting real-time audio

## Interactive RPM Controller
- [x] Large RPM gauge/tachometer display
- [x] Throttle slider with engine inertia simulation
- [x] Load control
- [x] Start/stop engine controls
- [x] Idle and rev commands
- [x] Redline indicator with rev limiter behavior
- [x] RPM sweep automation

## Visualization
- [x] Cylinder firing order animation
- [x] Real-time RPM/throttle/load indicators
- [x] Boost gauge for forced induction
- [x] Waveform or spectrum visualization

## Export System
- [x] Client-side WAV export with clipping protection
- [x] Client-side MP3 export
- [x] Normalization toggle
- [x] Server-side high-fidelity audio rendering for longer sequences
- [x] Downloadable file link for server-rendered exports

## Save/Load & Presets
- [x] Save engine configuration to user account
- [x] Load saved configurations
- [x] Factory presets (V8 cross-plane, flat-plane V8, inline-6, etc.)
- [x] Duplicate/rename configurations
- [x] Deterministic reproduction on restore

## Educational Tooltips
- [x] Contextual info for each control explaining sound influence
- [x] How firing interval changes pulse rhythm
- [x] How bank angle interacts with crankshaft design
- [x] How exhaust length affects resonance

## Community Gallery
- [x] Publish engine configs publicly
- [x] Browse community presets
- [x] Upvote system
- [x] Clone shared presets into own workspace

## User Authentication
- [x] Login/logout via Manus OAuth
- [x] User profile with saved engines
- [x] Protected routes for save/export features
