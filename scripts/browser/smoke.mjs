/**
 * Browser smoke test for the shipped app: drives the real UI in Chromium, records the audio
 * the v16 worklet actually produces, and checks every control round-trips.
 *
 *   npx vite --port 5199 &                        (or: npm run build && npx vite preview --port 5199)
 *   node scripts/browser/smoke.mjs --url http://127.0.0.1:5199/simulator --out browser-smoke
 *   python3 scripts/browser/report.py browser-smoke   (spectrogram contact sheet, needs numpy + matplotlib)
 *
 * Options: --only ls3,mazda-13b-fc   --skip-engines   --skip-controls   --skip-export   --stress   --ignore-https-errors
 *          --chrome /path/to/chrome  (default: the pre-installed Playwright Chromium)
 *
 * Audio is tapped after the output compressor (AnalyserNode → recorder worklet), so it is exactly
 * what reaches the speakers. Headless Chromium renders to a timer-driven null sink, so a render
 * that falls behind real time shows up as audio-clock lag against the wall clock.
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--");
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const baseUrl = opt("url", "http://127.0.0.1:5199/simulator");
const outDir = path.resolve(opt("out", "browser-smoke"));
const only = opt("only", "")?.split(",").filter(Boolean) ?? [];
const chrome = opt("chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome");
mkdirSync(path.join(outDir, "audio"), { recursive: true });

const RECORDER = `
class EssTestRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data.on; }; }
  process(inputs) {
    const input = inputs[0];
    if (this.on && input && input[0]) {
      const l = input[0].slice();
      const r = (input[1] || input[0]).slice();
      this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    }
    return true;
  }
}
registerProcessor("ess-test-recorder", EssTestRecorder);`;

const results = { url: baseUrl, startedAt: new Date().toISOString(), engines: [], controls: [], exports: [], console: [], failures: [] };
const fail = (where, message) => {
  results.failures.push({ where, message });
  console.log(`  FAIL ${where}: ${message}`);
};

const browser = await chromium.launch({ executablePath: chrome, args: ["--autoplay-policy=no-user-gesture-required"] });
// --ignore-https-errors: for a live URL behind an intercepting proxy whose CA Chromium does not trust.
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true, ignoreHTTPSErrors: flag("ignore-https-errors") });
const page = await context.newPage();
page.on("console", (m) => {
  const text = m.text();
  if (/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID|React DevTools|\[vite\]/.test(text)) return;
  results.console.push({ type: m.type(), text, at: Date.now() });
});
page.on("pageerror", (e) => results.console.push({ type: "pageerror", text: e.message, at: Date.now() }));
page.on("response", (r) => { if (r.status() >= 400 && !/fonts\.g/.test(r.url())) results.console.push({ type: "http", text: `${r.status()} ${r.url()}`, at: Date.now() }); });

const sep = baseUrl.includes("?") ? "&" : "?";
await page.goto(`${baseUrl}${sep}essDebug`, { waitUntil: "networkidle" });

// ---- start the engine through the UI (a real user gesture)
await page.getByRole("button", { name: /start engine/i }).click();
await page.waitForFunction(() => window.__ess?.getContext()?.state === "running" && !!window.__ess.getTelemetry(), null, { timeout: 15000 });

// ---- install the recorder on the output bus
await page.evaluate(async (src) => {
  const ess = window.__ess;
  const ctx = ess.getContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
  const rec = new AudioWorkletNode(ctx, "ess-test-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  ess.getAnalyser().connect(rec);
  rec.connect(mute).connect(ctx.destination);
  const state = { chunks: [], tele: [], timer: 0, t0: 0, w0: 0 };
  rec.port.onmessage = (e) => state.chunks.push(e.data);
  window.__rec = {
    start() {
      state.chunks = [];
      state.tele = [];
      state.t0 = ctx.currentTime;
      state.w0 = performance.now();
      rec.port.postMessage({ on: true });
      state.timer = setInterval(() => {
        const t = ess.getTelemetry();
        const a = ess.getAudioStats();
        if (t) state.tele.push({ load: a?.load, machineFactor: a?.machineFactor, t: ctx.currentTime - state.t0, rpm: t.rpm, engineState: t.engineState, gear: t.gear, speedKmh: t.speedKmh, limiter: t.limiter, splDb: t.splDb, boostKpa: t.boostKpa, brakeTorqueNm: t.brakeTorqueNm });
      }, 100);
    },
    async stop() {
      rec.port.postMessage({ on: false });
      clearInterval(state.timer);
      await new Promise((r) => setTimeout(r, 60));
      const audioSec = ctx.currentTime - state.t0;
      const wallSec = (performance.now() - state.w0) / 1000;
      const n = state.chunks.reduce((s, c) => s + c.l.length, 0);
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      let o = 0;
      for (const c of state.chunks) { l.set(c.l, o); r.set(c.r, o); o += c.l.length; }
      const b64 = (a) => { const u = new Uint8Array(a.buffer); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return { sampleRate: ctx.sampleRate, audioSec, wallSec, left: b64(l), right: b64(r), tele: state.tele, info: ess.getEngineInfo() };
    },
  };
}, RECORDER);

const decode = (b64) => { const buf = Buffer.from(b64, "base64"); return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); };
const sleep = (ms) => page.waitForTimeout(ms);
const click = (name) => page.getByRole("button", { name, exact: true }).click();

function writeWav(file, left, right, sampleRate) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, buf);
}

/** Level, finiteness, clipping and silent gaps of one stretch of a capture. */
function analyse(left, right, sampleRate, from, to) {
  const a = Math.max(0, Math.floor(from * sampleRate));
  const b = Math.min(left.length, Math.floor(to * sampleRate));
  let sum = 0, peak = 0, nonFinite = 0, clipped = 0, run = 0, maxRun = 0;
  for (let i = a; i < b; i++) {
    const l = left[i], r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nonFinite++; continue; }
    sum += l * l + r * r;
    const m = Math.max(Math.abs(l), Math.abs(r));
    if (m > peak) peak = m;
    if (m >= 0.999) clipped++;
    if (m < 1e-5) { run++; if (run > maxRun) maxRun = run; } else run = 0;
  }
  const count = Math.max(1, b - a);
  return { rmsDb: 10 * Math.log10(sum / (2 * count) + 1e-20), peak, nonFinite, clipped, maxSilentMs: (maxRun / sampleRate) * 1000 };
}

async function capture(label, script) {
  await page.evaluate(() => window.__rec.start());
  const marks = await script();
  const raw = await page.evaluate(() => window.__rec.stop());
  const left = decode(raw.left);
  const right = decode(raw.right);
  writeWav(path.join(outDir, "audio", `${label}.wav`), left, right, raw.sampleRate);
  return { ...raw, left, right, marks };
}

// ---- 1. every reference engine: idle, full-throttle free rev, lift-off
const presetSelect = page.locator("select").first();
const refKeys = (await presetSelect.locator("option").evaluateAll((os) => os.map((o) => o.value))).filter((v) => v.startsWith("ref:")).map((v) => v.slice(4));

if (!flag("skip-engines")) {
  console.log(`Engines (${only.length ? only.length : refKeys.length}):`);
  for (const key of refKeys) {
    if (only.length && !only.includes(key)) continue;
    const before = await page.evaluate(() => window.__ess.getEngineInfo()?.builds ?? 0);
    await click("Idle");
    await presetSelect.selectOption(`ref:${key}`);
    const ready = await page.waitForFunction((b) => (window.__ess.getEngineInfo()?.builds ?? 0) > b, before, { timeout: 8000 }).then(() => true, () => false);
    if (!ready) fail(key, "no 'ready' message from the worklet after selecting the preset");
    const cap = await capture(key, async () => {
      await sleep(2000);
      await click("Full throttle");
      await sleep(2500);
      await click("Idle");
      await sleep(2000);
      return { wotAt: 2.0, liftAt: 4.5, end: 6.5 };
    });
    const sr = cap.sampleRate;
    const idle = analyse(cap.left, cap.right, sr, 0.4, 2.0);
    const wot = analyse(cap.left, cap.right, sr, 2.6, 4.5);
    const lift = analyse(cap.left, cap.right, sr, 4.6, 6.4);
    const whole = analyse(cap.left, cap.right, sr, 0.06, cap.left.length / sr);
    const idleRpm = median(cap.tele.filter((t) => t.t > 0.8 && t.t < 2.0).map((t) => t.rpm));
    const wotRpm = Math.max(0, ...cap.tele.filter((t) => t.t > 2.0 && t.t < 4.6).map((t) => t.rpm));
    const clockRatio = cap.audioSec / cap.wallSec;
    const loads = cap.tele.map((t) => t.load).filter((x) => Number.isFinite(x));
    const maxLoad = loads.length ? Math.max(...loads) : NaN;
    const machineFactor = cap.tele.at(-1)?.machineFactor;
    const row = { key, maxLoad, machineFactor, internalRate: cap.info?.internalRate, displacementL: cap.info?.displacementL, idleRpm, wotRpm, idleDb: idle.rmsDb, wotDb: wot.rmsDb, liftDb: lift.rmsDb, peak: whole.peak, clipped: whole.clipped, nonFinite: whole.nonFinite, maxSilentMs: whole.maxSilentMs, clockRatio, samples: cap.left.length };
    results.engines.push(row);
    const problems = [];
    if (whole.nonFinite) problems.push(`${whole.nonFinite} non-finite samples`);
    if (idle.rmsDb < -60) problems.push(`idle too quiet (${idle.rmsDb.toFixed(1)} dBFS)`);
    if (!(wot.rmsDb > idle.rmsDb)) problems.push(`WOT (${wot.rmsDb.toFixed(1)}) not louder than idle (${idle.rmsDb.toFixed(1)})`);
    if (whole.maxSilentMs > 20) problems.push(`silent gap ${whole.maxSilentMs.toFixed(0)} ms`);
    if (!(wotRpm > idleRpm * 1.5)) problems.push(`rpm did not rise (idle ${idleRpm?.toFixed(0)}, WOT max ${wotRpm.toFixed(0)})`);
    if (clockRatio < 0.97) problems.push(`audio clock ran at ${(clockRatio * 100).toFixed(1)} % of real time (render falling behind)`);
    if (whole.clipped > 0) problems.push(`${whole.clipped} clipped samples`);
    for (const p of problems) fail(key, p);
    console.log(`  ${problems.length ? "FAIL" : "ok  "} ${key.padEnd(24)} rate ${String(row.internalRate).padStart(5)} | idle ${idleRpm?.toFixed(0).padStart(5)} rpm ${idle.rmsDb.toFixed(1).padStart(6)} dB | WOT ${wotRpm.toFixed(0).padStart(5)} rpm ${wot.rmsDb.toFixed(1).padStart(6)} dB | peak ${whole.peak.toFixed(2)} | gap ${whole.maxSilentMs.toFixed(1)} ms | clock ${(clockRatio * 100).toFixed(1)} % | load ${(maxLoad * 100).toFixed(0)} % mf ${machineFactor?.toFixed(2)}`);
  }
}

function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---- 2. controls round-trip
async function control(name, fn) {
  try {
    const detail = await fn();
    results.controls.push({ name, ok: true, detail });
    console.log(`  ok   ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    results.controls.push({ name, ok: false, detail: String(error?.message ?? error) });
    fail(`control: ${name}`, String(error?.message ?? error));
  }
}
const tele = () => page.evaluate(() => window.__ess.getTelemetry());
const info = () => page.evaluate(() => window.__ess.getEngineInfo());
const waitTele = (pred, arg, timeout = 8000) => page.waitForFunction(pred, arg, { timeout, polling: 100 });
const quickSelect = (labelText) => page.locator("label", { hasText: new RegExp(`^${labelText}$`, "i") }).locator("xpath=ancestor::div[contains(@class,'space-y-1.5')][1]").locator("select");
const expect = (cond, message) => { if (!cond) throw new Error(message); };

if (!flag("skip-controls")) {
  console.log("Controls:");
  await click("Idle");
  await presetSelect.selectOption("ref:gm-ls3");
  await sleep(1500);

  await control("Free rev: throttle raises rpm, Idle returns it", async () => {
    await click("Full throttle");
    await waitTele(() => window.__ess.getTelemetry().rpm > 4000);
    await click("Idle");
    await waitTele(() => window.__ess.getTelemetry().rpm < 1200, null, 10000);
    return `back to ${Math.round((await tele()).rpm)} rpm`;
  });

  await control("Throttle slider round-trips to the worklet", async () => {
    const slider = page.locator("label", { hasText: /^Throttle$/ }).locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]").locator("input[type=range]");
    await slider.focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
    await waitTele(() => (window.__ess.getState().throttle > 0.25) && window.__ess.getTelemetry().rpm > 1500);
    const s = await page.evaluate(() => window.__ess.getState());
    await click("Idle");
    return `throttle ${Math.round(s.throttle * 100)} % → ${Math.round(s.rpm)} rpm`;
  });

  await control("Dyno hold holds the set-point at full throttle", async () => {
    await click("Dyno hold");
    // The RPM slider is the dyno set-point; drive it through the engine API to hit exactly 3000.
    await page.evaluate(() => { window.__ess.setRPM(3000); window.__ess.setThrottle(1); });
    await sleep(2500);
    const t = await tele();
    await click("Idle");
    expect(Math.abs(t.rpm - 3000) < 150, `rpm ${t.rpm.toFixed(0)} not held at 3000`);
    return `${Math.round(t.rpm)} rpm, ${Math.round(t.brakeTorqueNm)} N·m`;
  });

  await control("Ignition off stops the engine; Crank / start restarts it", async () => {
    await sleep(800);
    await click("Ignition off");
    await waitTele(() => window.__ess.getTelemetry().engineState === "off" && window.__ess.getTelemetry().rpm < 50, null, 10000);
    await click("Crank / start");
    const seen = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const t = await tele();
      seen.add(t.engineState);
      if (t.engineState === "running" && t.rpm > 500) break;
      await sleep(100);
    }
    const t = await tele();
    expect(t.engineState === "running", `engine state ${t.engineState} after cranking`);
    return `states seen: ${[...seen].join(" → ")}; idling at ${Math.round(t.rpm)} rpm`;
  });

  await control("Drive mode: launch, auto-shift, manual shifts, brake", async () => {
    await click("Drive");
    await sleep(300);
    await click("Full throttle");
    await sleep(6000);
    const moving = await tele();
    expect(moving.speedKmh > 40, `only ${moving.speedKmh?.toFixed(0)} km/h after 6 s`);
    expect(moving.gear >= 2, `still in gear ${moving.gear}`);
    await click("Idle");
    await click("Auto-shift"); // off
    const g0 = (await tele()).gear;
    await click("Shift −");
    await sleep(1200);
    const g1 = (await tele()).gear;
    await click("Shift +");
    await sleep(1200);
    const g2 = (await tele()).gear;
    expect(g1 === g0 - 1 && g2 === g0, `gears ${g0} → ${g1} → ${g2}`);
    await click("Auto-shift"); // back on
    const brake = page.getByRole("button", { name: "Brake (hold)" });
    const box = await brake.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(5000);
    const braked = await tele();
    await page.mouse.up();
    expect(braked.speedKmh < moving.speedKmh * 0.6, `brake: ${moving.speedKmh.toFixed(0)} → ${braked.speedKmh.toFixed(0)} km/h`);
    await click("Free rev");
    return `${moving.speedKmh.toFixed(0)} km/h in gear ${moving.gear} after 6 s; shifts ${g0}→${g1}→${g2}; brake to ${braked.speedKmh.toFixed(0)} km/h`;
  });

  await control("Dyno pull button runs WOT to redline and lifts", async () => {
    await click("Dyno Pull (WOT → Redline, Lift)");
    let max = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) { max = Math.max(max, (await tele()).rpm); await sleep(150); }
    const s = await page.evaluate(() => window.__ess.getState());
    expect(max > 5500, `peak ${max.toFixed(0)} rpm`);
    expect(s.throttle === 0 && s.driveMode === "free", `after the pull: throttle ${s.throttle}, mode ${s.driveMode}`);
    return `peak ${Math.round(max)} rpm, then lift to free rev`;
  });

  await control("Listener perspective round-trips", async () => {
    const sel = page.locator("select").filter({ has: page.locator("option[value=cabin]") }).first();
    const values = await sel.locator("option").evaluateAll((os) => os.map((o) => o.value));
    const out = [];
    for (const v of values) {
      await sel.selectOption(v);
      await sleep(700);
      out.push(`${v} ${(await tele()).splDb.toFixed(0)} dB`);
      expect((await page.evaluate(() => window.__ess.getPerspective())) === v, `perspective did not become ${v}`);
    }
    await sel.selectOption("exterior-rear");
    return out.join(", ");
  });

  await control("Stem gain slider changes the output level", async () => {
    const level = async () => { const c = await capture("_stem", async () => { await sleep(1200); }); return analyse(c.left, c.right, c.sampleRate, 0.2, 1.2).rmsDb; };
    const before = await level();
    const panel = page.locator("text=Exhaust radiation").locator("xpath=..").locator("xpath=..");
    const slider = panel.locator("input[type=range]").first();
    await slider.focus();
    await page.keyboard.press("Home");
    const outlet = page.locator("text=Outlet jet").locator("xpath=..").locator("xpath=..").locator("input[type=range]").first();
    await outlet.focus();
    await page.keyboard.press("Home");
    await sleep(400);
    const after = await level();
    for (const s of [slider, outlet]) { await s.focus(); for (let i = 0; i < 100; i++) await page.keyboard.press("ArrowRight"); }
    await sleep(300);
    expect(after < before - 3, `level ${before.toFixed(1)} → ${after.toFixed(1)} dBFS`);
    return `${before.toFixed(1)} → ${after.toFixed(1)} dBFS with exhaust stems at 0`;
  });

  const engineType = quickSelect("Engine Type");
  for (const [value, expectText, check] of [
    ["four-stroke:diesel", "Pilot injection", (i) => i.displacementL > 0],
    ["two-stroke:gasoline", "Exhaust port opens", (i) => i.intervals.every((d) => d > 0)],
    ["rotary:gasoline", "Intake opens", (i) => i.firingOrder.length % 3 === 0],
    ["four-stroke:gasoline", "Valves / cylinder", () => true],
  ]) {
    await control(`Engine Type → ${value}: worklet rebuilds, family panel shows`, async () => {
      await click("Quick");
      const before = (await info()).builds;
      await engineType.selectOption(value);
      await page.waitForFunction((b) => window.__ess.getEngineInfo().builds > b, before, { timeout: 8000 });
      const i = await info();
      expect(check(i), `unexpected engine info ${JSON.stringify(i)}`);
      const label = value.startsWith("rotary") ? "Rotors" : "Cylinders";
      expect(await page.locator("label", { hasText: new RegExp(`^${label}$`) }).count() > 0, `quick build label is not "${label}"`);
      await click("Physics");
      const shown = await page.getByText(expectText, { exact: false }).count();
      expect(shown > 0, `Physics panel lacks "${expectText}"`);
      await click("Full throttle");
      await sleep(1500);
      const t = await tele();
      await click("Idle");
      expect(t.rpm > 1500 && Number.isFinite(t.splDb), `rpm ${t.rpm} after 1.5 s WOT`);
      return `${i.firingOrder.length} chambers, ${i.displacementL.toFixed(2)} L, WOT ${Math.round(t.rpm)} rpm`;
    });
  }

  await control("Rotors count changes the firing schedule", async () => {
    await click("Quick");
    await engineType.selectOption("rotary:gasoline");
    await sleep(1200);
    const rotorsSlider = page.locator("label", { hasText: /^Rotors$/ }).locator("xpath=ancestor::div[contains(@class,'space-y-1.5')][1]").locator("input[type=range]");
    const counts = [];
    await rotorsSlider.focus();
    await page.keyboard.press("Home");
    for (let k = 0; k < 4; k++) {
      await sleep(1200);
      counts.push((await info()).firingOrder.length / 3);
      await page.keyboard.press("ArrowRight");
    }
    await engineType.selectOption("four-stroke:gasoline");
    expect(new Set(counts).size >= 3, `rotor counts seen: ${counts.join(", ")}`);
    return `rotors seen: ${counts.join(", ")}`;
  });
}

// ---- 2b. rate tiering under load (--stress): busy-loop processes starve the audio thread; the worklet
// must step down to a lower internal rate and crossfade without a gap.
if (flag("stress")) {
  console.log("Rate tiering under CPU load:");
  const { spawn } = await import("node:child_process");
  const { cpus } = await import("node:os");
  await click("Idle");
  await presetSelect.selectOption("ref:gm-ls3");
  await sleep(2500);
  const startRate = (await info()).internalRate;
  const burners = [];
  const cap = await capture("stress-ls3", async () => {
    await click("Full throttle");
    await sleep(1500);
    for (let i = 0; i < cpus().length * 3; i++) burners.push(spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && !results.console.some((c) => /internal rate/.test(c.text))) await sleep(250);
    const stepAt = (Date.now() - t0) / 1000;
    for (const b of burners) b.kill("SIGKILL");
    await sleep(2500);
    await click("Idle");
    return { stepAt };
  });
  const steps = results.console.filter((c) => /internal rate/.test(c.text)).map((c) => c.text);
  const whole = analyse(cap.left, cap.right, cap.sampleRate, 0.1, cap.left.length / cap.sampleRate);
  results.stress = { startRate, endRate: (await info()).internalRate, steps, stepAfterSec: cap.marks.stepAt, maxSilentMs: whole.maxSilentMs, nonFinite: whole.nonFinite, clockRatio: cap.audioSec / cap.wallSec };
  // Chromium's audio thread runs at real-time priority, so busy processes may not starve it at all.
  // Then no step is needed, and the step-down path is covered by client/src/lib/ess/essProcessor.test.ts.
  if (!steps.length && results.stress.clockRatio < 0.99) fail("stress", `audio fell behind (${(results.stress.clockRatio * 100).toFixed(1)} %) without a step-down`);
  if (!steps.length) console.log("  no step-down needed: the audio thread kept real time under load");
  if (whole.maxSilentMs > 20) fail("stress", `silent gap ${whole.maxSilentMs.toFixed(0)} ms around the step-down`);
  if (whole.nonFinite) fail("stress", `${whole.nonFinite} non-finite samples`);
  console.log(`  ${startRate} Hz → ${results.stress.endRate} Hz after ${cap.marks.stepAt.toFixed(1)} s of load; ${steps.join(" / ")}; longest gap ${whole.maxSilentMs.toFixed(1)} ms; audio clock ${(results.stress.clockRatio * 100).toFixed(1)} %`);
}

// ---- 3. export through the Export dialog for the new families
if (!flag("skip-export")) {
  console.log("Export:");
  for (const key of ["vw-ea288", "yamaha-rd350lc", "mazda-13b-fc", "toyota-2jz-gte"]) {
    if (!refKeys.includes(key)) { fail(`export ${key}`, "reference engine missing"); continue; }
    try {
      await presetSelect.selectOption(`ref:${key}`);
      await sleep(800);
      await page.getByRole("button", { name: "Export" }).first().click();
      const dialog = page.locator("text=Export Audio").locator("xpath=ancestor::div[contains(@class,'hud-panel') or contains(@class,'rounded')][1]");
      await page.evaluate(() => {
        // Track the longest gap between animation frames: a main-thread render freezes the page.
        const st = (window.__frames = { max: 0, last: performance.now(), on: true });
        const tick = (t) => { st.max = Math.max(st.max, t - st.last); st.last = t; if (st.on) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      const t0 = Date.now();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 120000 }),
        page.getByRole("button", { name: /^export (wav|mp3|audio)|download|render/i }).last().click(),
      ]);
      const ms = Date.now() - t0;
      const maxFrameGapMs = await page.evaluate(() => { window.__frames.on = false; return window.__frames.max; });
      const file = path.join(outDir, "audio", `export-${key}.wav`);
      await download.saveAs(file);
      const { readFileSync } = await import("node:fs");
      const buf = readFileSync(file);
      const sampleRate = buf.readUInt32LE(24);
      const channels = buf.readUInt16LE(22);
      const bits = buf.readUInt16LE(34);
      const dataBytes = buf.readUInt32LE(40);
      const frames = dataBytes / (channels * bits / 8);
      let peak = 0, sum = 0, nonzero = 0;
      for (let i = 44; i + 1 < buf.length; i += 2) { const v = buf.readInt16LE(i) / 32768; peak = Math.max(peak, Math.abs(v)); sum += v * v; if (v !== 0) nonzero++; }
      const rmsDb = 10 * Math.log10(sum / ((buf.length - 44) / 2) + 1e-20);
      const row = { key, ms, maxFrameGapMs, sampleRate, channels, bits, seconds: frames / sampleRate, peak, rmsDb, nonzeroShare: nonzero / ((buf.length - 44) / 2) };
      results.exports.push(row);
      const problems = [];
      if (Math.abs(row.seconds - 10) > 0.05) problems.push(`duration ${row.seconds.toFixed(2)} s, expected 10`);
      if (peak < 0.2 || rmsDb < -40) problems.push(`level too low (peak ${peak.toFixed(2)}, ${rmsDb.toFixed(1)} dBFS)`);
      if (peak > 0.9999) problems.push("clipped");
      if (maxFrameGapMs > 500) problems.push(`page froze for ${maxFrameGapMs.toFixed(0)} ms during the render`);
      for (const p of problems) fail(`export ${key}`, p);
      console.log(`  ${problems.length ? "FAIL" : "ok  "} ${key.padEnd(24)} ${row.seconds.toFixed(2)} s @ ${sampleRate} Hz ×${channels}, peak ${peak.toFixed(2)}, ${rmsDb.toFixed(1)} dBFS, render ${ms} ms, longest page stall ${maxFrameGapMs.toFixed(0)} ms`);
      await page.keyboard.press("Escape");
      const close = page.locator("button:has(svg.lucide-x)").first();
      if (await close.count()) await close.click().catch(() => {});
      void dialog;
    } catch (error) {
      fail(`export ${key}`, String(error?.message ?? error));
    }
  }
}

results.finishedAt = new Date().toISOString();
const warnings = results.console.filter((c) => c.type === "error" || c.type === "pageerror" || c.type === "warning");
results.rateMessages = results.console.filter((c) => /internal rate/.test(c.text)).map((c) => c.text);
writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));
console.log(`\nconsole: ${warnings.length} warnings/errors; rate step-downs: ${results.rateMessages.length}`);
for (const w of warnings.slice(0, 20)) console.log(`  [${w.type}] ${w.text.slice(0, 200)}`);
console.log(results.failures.length ? `\n${results.failures.length} FAILURES` : "\nall checks pass");
await browser.close();
process.exit(results.failures.length ? 1 : 0);
