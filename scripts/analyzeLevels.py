"""Loudness and stem analysis of `scripts/levelSurvey.ts` renders.

  python scripts/analyzeLevels.py loudness <dir> [--csv out.csv]
  python scripts/analyzeLevels.py stems <dir> [--from-rpm-frac 0.7]
  python scripts/analyzeLevels.py compare <dirA> <dirB>
  python scripts/analyzeLevels.py figure <dirA> <dirB> out.png

loudness: per preset and program, ITU-R BS.1770-4 integrated loudness (LUFS, gated), the loudest 3 s
          (short-term) and 400 ms (momentary) windows, sample peak, share of samples at the limiter
          ceiling, and the leveler's gain range. The spread across presets is what "some presets are
          quieter than others" measures.
stems:    for presets rendered with STEMS=1, each stem's share of the calibrated pressure in bands
          (A-weighted overall, 1-4 kHz, 4-12 kHz) over the top of the run (last part of full
          throttle), and how tonal each band is (share of power on engine orders).
compare:  loudness of dirB minus dirA, preset by preset.
figure:   the same comparison as a chart, one panel per program (needs matplotlib).

Needs numpy and scipy only.
"""
import json
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

PROGRAMS = ["idle", "pull", "drive", "freerev"]
STEMS = ["exhaust", "exhaustNoValveJet", "exhaustJet", "intake", "structure", "accessory"]


def k_weight(x, fs):
    """BS.1770 K-weighting (high shelf + RLB high-pass), coefficients recomputed for fs."""
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / fs)
    vh, vb = 10 ** (g / 20), (10 ** (g / 20)) ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    b = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    y = signal.lfilter(b, a, x, axis=0)
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / fs)
    a0 = 1 + k / q + k * k
    return signal.lfilter([1, -2, 1], [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0], y, axis=0)


def block_power(y, fs, win, hop):
    n, h = int(win * fs), int(hop * fs)
    if len(y) < n:
        return np.array([np.mean(np.sum(y * y, axis=1))])
    c = np.concatenate([[0], np.cumsum(np.sum(y * y, axis=1))])
    idx = np.arange(0, len(y) - n + 1, h)
    return (c[idx + n] - c[idx]) / n


def lufs(p):
    return -0.691 + 10 * np.log10(np.maximum(p, 1e-12))


def loudness(x, fs):
    y = k_weight(x, fs)
    p = block_power(y, fs, 0.4, 0.1)
    gated = p[lufs(p) > -70]
    if len(gated) == 0:
        return dict(integrated=-99.0, short=-99.0, momentary=-99.0)
    rel = lufs(np.mean(gated)) - 10
    gated = gated[lufs(gated) > rel]
    return dict(integrated=float(lufs(np.mean(gated))), short=float(lufs(np.max(block_power(y, fs, 3.0, 0.1)))), momentary=float(lufs(np.max(p))))


def read(path):
    fs, x = wavfile.read(path)
    return fs, x.astype(np.float64)


def survey(directory):
    rows = {}
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".live.wav"):
            continue
        key, program = name.split(".")[:2]
        fs, x = read(os.path.join(directory, name))
        meta = json.load(open(os.path.join(directory, f"{key}.{program}.json")))
        _, raw = read(os.path.join(directory, f"{key}.{program}.raw.wav"))
        m = loudness(x, fs)
        peak = float(np.max(np.abs(x)))
        m.update(
            peak_db=20 * np.log10(max(peak, 1e-9)),
            at_ceiling=float(np.mean(np.max(np.abs(x), axis=1) > 10 ** (-2.05 / 20))),
            raw_peak_db=20 * np.log10(max(float(np.max(np.abs(raw))), 1e-9)),
            raw_lufs=loudness(raw, fs)["integrated"],
            gain_min=float(np.min(meta["gainDb"])),
            gain_max=float(np.max(meta["gainDb"])),
            crest=20 * np.log10(max(peak, 1e-9)) - 10 * np.log10(max(float(np.mean(x * x)), 1e-12)),
            name=meta["name"],
            lim1=100 * meta.get("limiterOver1dB", float("nan")),
            lim3=100 * meta.get("limiterOver3dB", float("nan")),
        )
        rows[(key, program)] = m
    return rows


def cmd_loudness(directory, csv=None):
    rows = survey(directory)
    keys = sorted({k for k, _ in rows})
    lines = ["key,program,integrated,short,momentary,peak_db,at_ceiling,raw_lufs,raw_peak_db,gain_min,gain_max,crest"]
    for program in PROGRAMS:
        vals = [(rows[(k, program)]["integrated"], k) for k in keys if (k, program) in rows]
        if not vals:
            continue
        v = np.array([a for a, _ in vals])
        print(f"\n== {program}: integrated LUFS  median {np.median(v):.1f}  min {v.min():.1f}  max {v.max():.1f}  spread {v.max() - v.min():.1f}  sd {v.std():.1f}")
        print(f"{'preset':24s} {'LUFS-I':>7s} {'ST max':>7s} {'M max':>7s} {'peak':>6s} {'ceil%':>6s} {'rawLUFS':>8s} {'rawPk':>6s} {'gain dB':>13s} {'crest':>6s} {'lim>1dB%':>8s} {'>3dB%':>6s}")
        for _, k in sorted(vals):
            r = rows[(k, program)]
            print(f"{k:24s} {r['integrated']:7.1f} {r['short']:7.1f} {r['momentary']:7.1f} {r['peak_db']:6.1f} {100 * r['at_ceiling']:6.2f} {r['raw_lufs']:8.1f} {r['raw_peak_db']:6.1f} {r['gain_min']:6.1f}…{r['gain_max']:5.1f} {r['crest']:6.1f} {r['lim1']:8.1f} {r['lim3']:6.1f}")
            lines.append(",".join([k, program] + [f"{r[c]:.2f}" for c in ["integrated", "short", "momentary", "peak_db", "at_ceiling", "raw_lufs", "raw_peak_db", "gain_min", "gain_max", "crest"]]))
    if csv:
        open(csv, "w").write("\n".join(lines) + "\n")


def a_weight_power(f):
    f2 = np.maximum(f, 1e-3) ** 2
    ra = (12194.0**2 * f2 * f2) / ((f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194.0**2))
    return (ra * 10 ** (2.0 / 20)) ** 2


def band_powers(x, fs):
    mono = x.mean(axis=1)
    f, p = signal.welch(mono, fs, nperseg=8192, noverlap=4096)
    out = {"A": float(np.sum(p * a_weight_power(f)))}
    for name, lo, hi in [("0.1-1k", 100, 1000), ("1-4k", 1000, 4000), ("4-12k", 4000, 12000)]:
        out[name] = float(np.sum(p[(f >= lo) & (f < hi)]))
    return out


def top_window(meta, frac):
    """Samples of the full-throttle part above `frac` of the highest speed reached."""
    track = [r for r in meta["track"] if r["throttle"] > 0.9]
    top = max(r["rpm"] for r in track)
    sel = [r["t"] for r in track if r["rpm"] >= frac * top]
    return min(sel), max(sel) + 0.05, top


def cmd_stems(directory, frac=0.7):
    db = lambda v: 10 * np.log10(max(v, 1e-30))
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".raw.wav"):
            continue
        key, program = name.split(".")[:2]
        if not os.path.exists(os.path.join(directory, f"{key}.{program}.exhaust.wav")):
            continue
        meta = json.load(open(os.path.join(directory, f"{key}.{program}.json")))
        t0, t1, top = top_window(meta, frac)
        fs, raw = read(os.path.join(directory, name))
        seg = slice(int(t0 * fs), int(t1 * fs))
        total = band_powers(raw[seg], fs)
        print(f"\n{key} {program}: {t0:.1f}-{t1:.1f} s, top {top} rpm; mix A {db(total['A']):.1f} dB re FS")
        print(f"  {'stem':17s} {'A-wtd':>7s} {'0.1-1k':>7s} {'1-4k':>7s} {'4-12k':>7s}   (dB relative to the mix in the same band)")
        for stem in STEMS:
            _, s = read(os.path.join(directory, f"{key}.{program}.{stem}.wav"))
            b = band_powers(s[seg], fs)
            print(f"  {stem:17s} " + " ".join(f"{db(b[c]) - db(total[c]):7.1f}" for c in ["A", "0.1-1k", "1-4k", "4-12k"]))


def cmd_compare(a, b):
    ra, rb = survey(a), survey(b)
    for program in PROGRAMS:
        common = sorted(k for k in ra if k in rb and k[1] == program)
        if not common:
            continue
        va = np.array([ra[k]["integrated"] for k in common])
        vb = np.array([rb[k]["integrated"] for k in common])
        print(f"\n== {program}: spread {va.max() - va.min():.1f} -> {vb.max() - vb.min():.1f} LU, sd {va.std():.1f} -> {vb.std():.1f}, median {np.median(va):.1f} -> {np.median(vb):.1f}")
        for k in common:
            print(f"{k[0]:24s} {ra[k]['integrated']:7.1f} -> {rb[k]['integrated']:7.1f} ({rb[k]['integrated'] - ra[k]['integrated']:+5.1f})  peak {ra[k]['peak_db']:5.1f} -> {rb[k]['peak_db']:5.1f}  ceil% {100 * ra[k]['at_ceiling']:.2f} -> {100 * rb[k]['at_ceiling']:.2f}")


def cmd_figure(a, b, out):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ra, rb = survey(a), survey(b)
    titles = {"idle": "Idle", "pull": "Dyno pull", "drive": "0–100 km/h", "freerev": "Free rev to the limiter"}
    fig, axes = plt.subplots(1, 4, figsize=(17, 9.5), sharey=True)
    keys = sorted({k for k, _ in ra if (k, "pull") in rb}, key=lambda k: ra[(k, "pull")]["integrated"])
    for ax, program in zip(axes, PROGRAMS):
        y = np.arange(len(keys))
        va = np.array([ra[(k, program)]["integrated"] for k in keys])
        vb = np.array([rb[(k, program)]["integrated"] for k in keys])
        ax.hlines(y, va, vb, color="#b8bcc4", linewidth=1.2, zorder=1)
        ax.scatter(va, y, s=26, color="#8a8f98", label="before", zorder=2)
        ax.scatter(vb, y, s=26, color="#1f6feb", label="after", zorder=3)
        ax.set_title(f"{titles[program]}\nspread {va.max() - va.min():.1f} → {vb.max() - vb.min():.1f} LU", fontsize=11)
        ax.set_xlabel("integrated loudness, LUFS")
        ax.grid(axis="x", color="#e3e5e8", linewidth=0.8)
        ax.set_axisbelow(True)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.tick_params(axis="y", length=0)
    axes[0].set_yticks(np.arange(len(keys)))
    axes[0].set_yticklabels(keys, fontsize=8)
    fig.legend(*axes[0].get_legend_handles_labels(), loc="lower center", ncol=2, frameon=False)
    fig.suptitle("Loudness of every preset after the output leveler (exterior rear, 48 kHz), sorted by the old dyno-pull loudness", fontsize=12)
    fig.tight_layout(rect=(0, 0.03, 1, 0.97))
    fig.savefig(out, dpi=110)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[0] == "loudness":
        cmd_loudness(args[1], args[args.index("--csv") + 1] if "--csv" in args else None)
    elif args[0] == "stems":
        cmd_stems(args[1], float(args[args.index("--from-rpm-frac") + 1]) if "--from-rpm-frac" in args else 0.7)
    elif args[0] == "compare":
        cmd_compare(args[1], args[2])
    elif args[0] == "figure":
        cmd_figure(args[1], args[2], args[3])
