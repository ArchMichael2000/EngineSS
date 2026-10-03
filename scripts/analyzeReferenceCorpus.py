"""Derive reference statistics from real engine recordings.

Currently supports the Humain-Lab Car Engine Audio Database (HL-CEAD):
https://github.com/MachineLearningVisionRG/machine_biometrics
(hood open, microphone over the engine, neutral gear, steady 1000/1500/2000 rpm,
phone recorder with noise/echo cancellation enabled -- treat HF/noise-floor
figures as lower bounds).

    python3 scripts/analyzeReferenceCorpus.py <MLVRG-Car-Engine-Audio dir> <out.json>
"""
import json, os, sys, wave
import numpy as np

root, out_path = sys.argv[1], sys.argv[2]

def read_wav(path):
    with wave.open(path, "rb") as w:
        sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768
    elif sw == 4:
        x = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2**31
    else:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float64) - 128) / 128
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr

def stats(x, sr, nominal_rpm):
    x = x - x.mean()
    seg = x[int(1.0 * sr): int(1.0 * sr) + int(8 * sr)]
    if len(seg) < sr * 4:
        return None
    w = np.hanning(len(seg))
    s = np.abs(np.fft.rfft(seg * w)) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    band = lambda lo, hi: s[(f >= lo) & (f < hi)].sum()
    total = band(20, sr / 2)
    # Estimate true cycle rate (rpm/120): maximise energy on its harmonics within +-15% of nominal.
    best = (0, nominal_rpm)
    for rpm in np.linspace(nominal_rpm * 0.85, nominal_rpm * 1.15, 241):
        cyc = rpm / 120
        k = np.arange(1, int(1500 / cyc))
        idx = np.searchsorted(f, k * cyc)
        e = sum(s[max(i - 1, 0):i + 2].sum() for i in idx if i < len(s))
        if e > best[0]:
            best = (e, rpm)
    rpm = best[1]
    cyc = rpm / 120
    kk = np.round(f / cyc)
    locked = (np.abs(f - kk * cyc) < 1.5) & (kk >= 1) & (f > 20)
    orders = {}
    for co in range(1, 25):
        orders[co / 2] = float(s[np.abs(f - co * cyc) < 1.5].sum() / total)
    flat_band = s[(f > 100) & (f < 8000)]
    flatness = np.exp(np.mean(np.log(flat_band + 1e-30))) / np.mean(flat_band)
    rms = np.sqrt(np.mean(seg ** 2))
    return {
        "nominal_rpm": nominal_rpm,
        "estimated_rpm": round(float(rpm)),
        "centroid_hz": round(float((f * s).sum() / s.sum())),
        "band_pct": {k: round(100 * band(lo, hi) / total, 2) for k, (lo, hi) in
                     {"<100": (20, 100), "100-500": (100, 500), "500-2k": (500, 2000), "2k-8k": (2000, 8000), ">8k": (8000, sr / 2)}.items()},
        "flatness_100_8k": round(float(flatness), 4),
        "order_locked_pct": round(float(100 * s[locked].sum() / total), 1),
        "crest_factor": round(float(np.max(np.abs(seg)) / max(rms, 1e-12)), 2),
        "top_orders": sorted(((o, round(100 * v, 1)) for o, v in orders.items()), key=lambda t: -t[1])[:5],
    }

rows = []
for dirpath, _, files in os.walk(root):
    for fn in sorted(files):
        if not fn.endswith(".wav"):
            continue
        parts = os.path.relpath(os.path.join(dirpath, fn), root).split(os.sep)
        if len(parts) != 4:
            continue
        make, model, rpm_dir, _ = parts
        x, sr = read_wav(os.path.join(dirpath, fn))
        st = stats(x, sr, int(rpm_dir))
        if st:
            st.update({"make": make, "model": model, "file": fn})
            rows.append(st)

def summary(sel):
    arr = lambda key: np.array([r[key] for r in sel], dtype=float)
    bands = {k: np.array([r["band_pct"][k] for r in sel]) for k in sel[0]["band_pct"]}
    q = lambda a: [round(float(np.percentile(a, p)), 3) for p in (10, 50, 90)]
    return {
        "count": len(sel),
        "centroid_hz_p10_p50_p90": q(arr("centroid_hz")),
        "flatness_p10_p50_p90": q(arr("flatness_100_8k")),
        "order_locked_pct_p10_p50_p90": q(arr("order_locked_pct")),
        "crest_factor_p10_p50_p90": q(arr("crest_factor")),
        "band_pct_p50": {k: round(float(np.median(v)), 2) for k, v in bands.items()},
        "band_pct_p10_p90": {k: [round(float(np.percentile(v, 10)), 2), round(float(np.percentile(v, 90)), 2)] for k, v in bands.items()},
    }

out = {
    "source": "Humain-Lab Car Engine Audio Database (HL-CEAD), Sidiropoulos & Papakostas, IEEE AIIoT 2021",
    "source_url": "https://github.com/MachineLearningVisionRG/machine_biometrics",
    "perspective": "engine-bay, hood open, microphone over engine centre, neutral (no load), steady rpm",
    "caveats": [
        "Phone recorder with noise and echo cancellation enabled: stationary broadband noise may be suppressed, so flatness and HF shares are lower bounds.",
        "Mostly small production inline-3/inline-4 cars (petrol and diesel not separated).",
        "No-load (neutral) operation: combustion pressures are near idle levels at all three speeds.",
    ],
    "by_nominal_rpm": {str(r): summary([x for x in rows if x["nominal_rpm"] == r]) for r in (1000, 1500, 2000)},
    "all": summary(rows),
    "recordings": rows,
}
json.dump(out, open(out_path, "w"), indent=1)
print(json.dumps({k: out[k] for k in ("by_nominal_rpm",)}, indent=1))
