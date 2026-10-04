# Legacy sound engine (v0–v15)

Everything here predates the v16 physical core (`shared/ess/`). It is kept so old renders can be reproduced and compared, and it is **never shipped**: nothing in `client/`, `shared/` or `server/` imports it. `shared/legacyIsolation.test.ts` enforces that, and the Pages workflow fails if the built site contains the legacy worklet.

| Path | What it is |
|---|---|
| `engineSoundModel.ts` | The additive "firing-event pulse" model used for offline export in v0–v15. |
| `combustionProcessor.ts` | Source of the live `combustion-processor` AudioWorklet (the v15 real-time engine). |
| `realtimeAudioMix.ts` | Live mix-bus settings (filters, compressor, accessory oscillators) per profile. |
| `soundProfiles.ts` | The profile list (v0, v8–v15) and the `is…SoundProfile` switches the model branches on. |
| `legacyAudioEngine.ts` | `LegacyAudioEngine`, the v15 browser engine (worklet, filters, oscillators, export), minus the v16 core. Typechecked with the app but not wired into it. |
| `audioOutputDiagnostics.ts` | Offline worklet render used by the v15 audit. |
| `*.test.ts` | The original regression tests. They run with the main suite (`npx vitest run legacy`). |
| `v15-site-build/` | The built v15 site that used to sit in `docs/` (the live site deploys from the Actions build of `dist/`, not from these files). |
| `original-source-archive.zip` | The archive the project was first imported from. |

## Rendering legacy audio for A/B comparison

```bash
npx vite-node scripts/renderBaseline.ts -- <outDir>   # v15 worklet and offline renders of every factory preset
npx vite-node scripts/renderV16.ts -- <outDir>        # the same presets on the v16 core
```

Saved configurations whose `soundProfile` is `v15` or older still load in the app; they play on the v16 core.
