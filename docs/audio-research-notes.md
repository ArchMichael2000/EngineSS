# Engine Audio Research Notes

This simulator should treat engine sound as a layered, order-based mechanical signal with resonant intake and exhaust paths, not as one oscillator per engine or accessory.

## Combustion And Engine Orders

- Engine orders are frequencies tied directly to crank RPM. A frequency at order `k` is `rpm / 60 * k`.
- A four-stroke engine fires each cylinder once per 720 crank degrees, so the total firing rate is `rpm / 120 * cylinderCount`.
- The main combustion order for a four-stroke engine is `cylinderCount / 2`; for example, an even-fire V8 at 6000 RPM has a fourth-order firing rate of 400 Hz.
- Layout, crankshaft, firing order, bank angle, exhaust routing, and header length should change timing, amplitude, panning, and resonances around those orders.
- Cylinder count should not directly reduce live loudness. More cylinders increase pulse density and smoothness, while displacement, per-cylinder impulse energy, order balance, intake/exhaust geometry, and body resonances provide perceived depth and level.
- Enthusiast feedback tends to describe cross-plane V8 depth as a per-bank pulse-grouping effect, not a simple "eight cylinders are low pitched" effect. This supports preserving low-order/body energy on V10/V12 while making their pulse trains smoother and denser.

Sources:
- Siemens Simcenter, "What's an Order?": https://community.sw.siemens.com/articles/en_US/Knowledge/what-s-an-order
- How Engines Work, "The Sound of Engines": https://www.howengineswork.com/engines/piston/sound
- GTPlanet discussion, "Why is it 8 the magic number to get that deep growling engine sound?": https://www.gtplanet.net/forum/threads/why-is-it-8-the-magic-number-to-get-that-deep-growling-engine-sound.377805/

## Exhaust And Intake Character

- Exhaust sound starts as cylinder pressure pulses, then changes through headers, collectors, pipe length, mufflers, and tailpipe radiation.
- Header and pipe differences should create short delays, uneven pulse color, and resonant peaks rather than random noise.
- Intake sound should be throttle/load dependent and should include pulsed flow plus softened turbulence, especially for ITBs, carbs, and velocity stacks.
- Flat-plane V8s should keep an even-bank, higher-order blare; cross-plane V8s should emphasize staggered bank rhythm and low offbeat burble. Open headers and straight pipes should expose more blowdown/radiation/reflection energy rather than merely raising master gain.

Sources:
- VTT, "IC-engine acoustic source characterization in-situ with capsule tube method": https://cris.vtt.fi/en/publications/ic-engine-acoustic-source-characterization-in-situ-with-capsule-t/
- Applied Acoustics, "Simple analysis of exhaust noise produced by a four cylinder engine": https://www.sciencedirect.com/science/article/pii/0003682X94900655
- Autocar, "Under the skin: How flat-plane cranks enhance a V8 engine": https://www.autocar.co.uk/car-news/technology/under-skin-how-flat-plane-cranks-enhance-v8-engine
- Engineer Fix, "Why Do V8 Engines Sound So Good?": https://engineerfix.com/why-do-v8-engines-sound-so-good/

## Turbocharger Sound

- Turbo sound should not be a pure whistle. Useful layers are compressor/turbine broadband whoosh, a quieter blade-pass/rotor tone, wastegate/bypass events, and surge/flutter on throttle lift.
- Whoosh is broadband and flow-dependent. Research examples discuss compressor whoosh around broad bands such as 1-3 kHz or 4-12 kHz depending operating condition and measurement setup.
- Blade-pass frequency can add a high-frequency tonal cue, but it should be restrained so it does not dominate the combustion and exhaust note.
- Turbo layers should be coupled to spool/throttle/load. A continuous pure whistle reads as synthetic; gated broadband flow, restrained rotor tone, wastegate, and blow-off events are closer to both NVH descriptions and driver feedback.

Sources:
- Broatch et al., "Simulations and measurements of automotive turbocharger compressor whoosh noise": https://www.tandfonline.com/doi/abs/10.1080/19942060.2015.1004788
- Universitat Politecnica de Valencia RIUNET record for the same paper: https://riunet.upv.es/entities/publication/1c92b84f-b485-4698-8d2d-4de1020f01d4
- SAE, "Circumferential Variation of Noise at the Blade-Pass Frequency in a Turbocharger Compressor with Ported Shroud": https://saemobilus.sae.org/articles/circumferential-variation-noise-blade-pass-frequency-a-turbocharger-compressor-ported-shroud-2021-01-1044
- SAE, "Investigation of Compressor Whoosh Noise in Automotive Turbochargers": https://saemobilus.sae.org/articles/investigation-compressor-whoosh-noise-automotive-turbochargers-2009-01-2053

## Supercharger Sound

- Roots and twin-screw superchargers should combine gear whine, rotor/lobe passing pulses, and airflow/backflow pressure fluctuations.
- Centrifugal superchargers can lean more toward turbo-like high-speed compressor tone, but still need flow noise rather than a bare sine wave.
- Gear tone should be present but modest. Lobe/airflow modulation makes the sound feel attached to the engine instead of floating above it.

Sources:
- SAE, "Gear Design for Low Whine Noise in a Supercharger Application": https://saemobilus.sae.org/papers/gear-design-low-whine-noise-a-supercharger-application-2007-01-2293
- SAE, "Development of the Eaton Supercharger": https://saemobilus.sae.org/papers/development-eaton-supercharger-870355

## Capture Direction

- The procedural model should eventually be guided by a capture library grouped by RPM, load, throttle state, segment type, and mic perspective.
- Captures can provide spectral envelopes and transient examples while the simulator keeps mechanical timing and editable configuration control.
- Useful perspectives: engine bay/intake, cabin, rear/tailpipe, drive-by, dyno, and exterior idle/start.
