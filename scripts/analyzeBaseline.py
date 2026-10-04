"""Objective measurements of rendered engine audio (see scripts/renderBaseline.ts).

    python3 scripts/analyzeBaseline.py <renderDir>

Writes <renderDir>/report.json and prints a summary table.
"""
import json, sys, os
import numpy as np

d = sys.argv[1]
meta = json.load(open(os.path.join(d, "meta.json")))
SR = meta["sampleRate"]

def load(name):
    return np.fromfile(os.path.join(d, name + ".f32"), dtype=np.float32).astype(np.float64)

def db(x):
    return 20 * np.log10(max(x, 1e-12))

def steady_metrics(x, rpm, cyl):
    x = x[int(0.5 * SR):]                      # drop start-up transient
    rms = np.sqrt(np.mean(x ** 2))
    n = len(x)
    w = np.hanning(n)
    spec = np.abs(np.fft.rfft(x * w)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    total = spec[(f > 20)].sum()
    cyc = rpm / 120.0                          # half-order spacing (4-stroke cycle rate)
    # order-locked fraction: energy within +-1.5 Hz of any half-order harmonic
    k = np.round(f / cyc)
    locked = (np.abs(f - k * cyc) < 1.5) & (k >= 1) & (f > 20)
    order_frac = spec[locked].sum() / total
    # per-half-order energy (cycle orders 1..40)
    orders = {}
    for co in range(1, 41):
        m = np.abs(f - co * cyc) < 1.5
        orders[co] = spec[m].sum() / total
    firing_co = cyc and cyl                    # cycle order of firing frequency = cylinder count
    sub_firing = sum(v for co, v in orders.items() if co < cyl)
    firing_family = sum(v for co, v in orders.items() if co % cyl == 0)
    centroid = (f * spec).sum() / spec.sum()
    band = lambda lo, hi: spec[(f >= lo) & (f < hi)].sum() / total
    flat_band = spec[(f > 100) & (f < 8000)]
    flatness = np.exp(np.mean(np.log(flat_band + 1e-30))) / np.mean(flat_band)
    top = sorted(orders.items(), key=lambda kv: -kv[1])[:5]
    return dict(
        rms_dbfs=round(db(rms), 1),
        peak=round(float(np.max(np.abs(x))), 3),
        order_locked_pct=round(100 * order_frac, 1),
        firing_family_pct=round(100 * firing_family, 1),
        sub_firing_pct=round(100 * sub_firing, 1),
        centroid_hz=round(float(centroid)),
        band_pct={"<100": round(100 * band(20, 100), 1), "100-500": round(100 * band(100, 500), 1),
                  "500-2k": round(100 * band(500, 2000), 1), "2k-8k": round(100 * band(2000, 8000), 1), ">8k": round(100 * band(8000, SR / 2), 2)},
        flatness=round(float(flatness), 4),
        top_engine_orders=[(co / 2, round(100 * v, 1)) for co, v in top],
    )

def sweep_metrics(x, rpm0, rpm1, secs):
    hop = int(0.1 * SR)
    frames = []
    for i in range(0, len(x) - hop, hop):
        seg = x[i:i + hop]
        rpm = rpm0 + (rpm1 - rpm0) * min(1, (i / SR) / secs)
        s = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
        f = np.fft.rfftfreq(len(seg), 1 / SR)
        frames.append((rpm, db(np.sqrt(np.mean(seg ** 2))), float((f * s).sum() / max(s.sum(), 1e-30))))
    frames = np.array(frames[5:])
    # discontinuity detector: first difference outliers vs local scale
    dx = np.diff(x)
    local = np.convolve(np.abs(dx), np.ones(441) / 441, mode="same") + 1e-9
    clicks = int(np.sum(np.abs(dx) > 12 * local))
    slope = np.polyfit(np.log2(frames[:, 0]), frames[:, 1], 1)[0]
    return dict(
        rms_db_lo=round(float(frames[:5, 1].mean()), 1),
        rms_db_hi=round(float(frames[-5:, 1].mean()), 1),
        loudness_db_per_rpm_doubling=round(float(slope), 1),
        centroid_lo=round(float(frames[:5, 2].mean())),
        centroid_hi=round(float(frames[-5:, 2].mean())),
        click_outliers=clicks,
    )

report = {}
for name, m in meta["renders"].items():
    x = load(name)
    if m["label"] == "sweep":
        r = sweep_metrics(x, m["rpmStart"], m["rpmEnd"], m["seconds"])
    else:
        r = steady_metrics(x, m["rpm"], m["cylinders"])
    r.update({k: m[k] for k in ("cpuRealtimeFactor",) if k in m})
    report[name] = r

json.dump(report, open(os.path.join(d, "report.json"), "w"), indent=1)

presets = sorted({m["preset"] for m in meta["renders"].values()})
print(f"{'preset':16} {'state':14} {'rms':>6} {'lock%':>6} {'fire%':>6} {'sub%':>6} {'cent':>6} {'flat':>7} {'cpuRT':>6}  top orders")
for p in presets:
    for lab in ["idle", "cruise3000", "wot3000", "wot60", "wot90", "overrun60", "offline_wot60"]:
        if f"{p}__{lab}" not in report: continue
        r = report[f"{p}__{lab}"]
        print(f"{p:16} {lab:14} {r['rms_dbfs']:6} {r['order_locked_pct']:6} {r['firing_family_pct']:6} {r['sub_firing_pct']:6} {r['centroid_hz']:6} {r['flatness']:7} {r.get('cpuRealtimeFactor', 0):6.2f}  {r['top_engine_orders']}")
    s = report[f"{p}__sweep"]
    print(f"{p:16} sweep  rms {s['rms_db_lo']}->{s['rms_db_hi']} dB ({s['loudness_db_per_rpm_doubling']} dB/oct), centroid {s['centroid_lo']}->{s['centroid_hi']} Hz, clicks={s['click_outliers']}, cpuRT={s['cpuRealtimeFactor']:.2f}")
    print()
