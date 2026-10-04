"""Engine-order comparison between a real recording and a simulated render.

Recordings rarely carry an RPM channel, so speed is tracked from the audio itself:
a harmonic-sum salience over the half-order comb (four-stroke cycle rate rpm/120)
is evaluated on a log-spaced RPM grid per frame, and a dynamic-programming path
enforces continuity (engine speed cannot jump). The signal is then resampled to
the crank-angle domain, and per-order power is read from frequency-aligned FFT
frames spanning P crank revolutions, after Doerfler & Wyse, "Analysis-Driven
Procedural Generation of an Engine Sound Dataset with Embedded Control
Annotations" (EUSIPCO 2026; github.com/rdoerfler/engine-order-analysis).

    python3 scripts/compareRecording.py analyse <audio> --cylinders 8 --rpm-start 900 --out a.json [--rpm-min 600] [--rpm-max 8000]
    python3 scripts/compareRecording.py analyse <render.wav> --cylinders 8 --rpm-track track.json --out b.json
    python3 scripts/compareRecording.py compare <recording.json> <render.json> [--png fig.png]

`analyse` accepts anything ffmpeg decodes. Output JSON holds the RPM track and
per-frame order levels; `compare` aligns both files on RPM bins and reports the
order-profile error (dB, relative to each frame's total level), the broadband
(non-order) share, and the loudness-vs-RPM slope.
"""
import argparse, json, subprocess, sys
import numpy as np

SR = 48000
MID_WEIGHT = 0.0
FIRST_TOOTH_WEIGHT = 8.0
ORDERS = np.arange(0.5, 32.01, 0.5)


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def track_rpm(x, rpm_min, rpm_max, cylinders, rpm_start=None, fire_order=None, max_step=None, hop_s=0.05, win_s=0.3, smooth=3.0):
    """Harmonic-sum salience over the half-order comb on a log-frequency axis, plus Viterbi.

    The magnitude spectrum is mapped to a log-frequency axis and max-pooled over ±1.5 %, so a
    comb tooth still lands on its partial while the speed sweeps within the frame. On that axis the
    comb for any rpm is the same template shifted, so salience for the whole rpm grid is one
    cross-correlation per frame.
    """
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    hop, win = int(hop_s * SR), int(win_s * SR)
    nfft = 1 << int(np.ceil(np.log2(win * 2)))
    w = np.hanning(win)
    f = np.fft.rfftfreq(nfft, 1 / SR)
    step = np.log(1.0025)  # 0.25 % per log-frequency bin
    # Axis starts below the lowest tooth (order 0.5 at rpm_min); sub-15 Hz content is flattened.
    lf = np.arange(np.log(0.45 * rpm_min / 60), np.log(6000), step)
    pool = int(round(np.log(1.015) / step))
    envelope = int(round(np.log(2) / 3 / step)) * 2 + 1
    # Comb on the firing harmonics k·(n/2) of a four-stroke engine. Sub-multiples of the true speed
    # are also valid harmonic sets (strong low orders make the engine cycle the true period), so
    # the speed branch is fixed by the anchor `rpm_start` and held by the continuity penalty.
    fire = fire_order or cylinders / 2
    k = np.arange(1, 13)
    # The firing order itself is normally the dominant partial; a sub-multiple candidate puts its
    # first tooth on a weak low order, so the first tooth carries most of the weight.
    weights = 0.9 ** (k - 1)
    weights[0] = FIRST_TOOTH_WEIGHT
    teeth = np.round(np.log(k * fire) / step).astype(int)
    mids = np.round(np.log((k - 0.5) * fire) / step).astype(int)
    grid_lo, grid_hi = np.log(rpm_min / 60), np.log(rpm_max / 60)
    shifts = np.arange(int((grid_lo - lf[0]) / step), int((grid_hi - lf[0]) / step))
    frames = list(range(0, max(1, len(x) - win), hop))
    sal = np.zeros((len(frames), len(shifts)))
    for t, s in enumerate(frames):
        spec = np.abs(np.fft.rfft(x[s:s + win] * w, nfft))
        L = np.log(np.interp(np.exp(lf), f, spec) + 1e-6 * spec.max() + 1e-12)
        # Whiten: subtract a 1/3-octave envelope, so a tooth scores by being a local peak whatever
        # the overall spectral roll-off (a muffled exhaust falls 30 dB across the comb).
        L -= uniform_filter1d(L, envelope)
        L = maximum_filter1d(L, 2 * pool + 1)
        L[np.exp(lf) < 15] = 0
        for g, sh in enumerate(shifts):
            idx, mid = sh + teeth, sh + mids
            ok = (idx < len(L)) & (mid >= 0)
            if ok.sum() < 3:
                sal[t, g] = -1e9
                continue
            wk = weights[ok]
            sal[t, g] = ((L[idx[ok]] - MID_WEIGHT * L[mid[ok]]) * wk).sum() / wk.sum()
    grid = np.exp(lf[0] + shifts * step) * 60
    lg = np.log(grid)
    # Speed changes up to ~4 % per 50 ms hop (a hard pull or blip) are nearly free; faster ones,
    # which only a wrong harmonic branch would need, are expensive.
    dl = np.abs(lg[:, None] - lg[None, :])
    jump = 0.1 * dl / np.log(1.05) + smooth * np.maximum(0, dl - np.log(1.04)) / np.log(1.01)
    if max_step:
        # Hard limit for slow sweeps (dyno pulls): no path may change faster than this per hop.
        jump[dl > np.log(1 + max_step)] = 1e12
    score = sal[0].copy()
    if rpm_start:
        # Anchor: the first frame must lie within ±15 % of the supplied starting speed.
        score[np.abs(np.log(grid / rpm_start)) > np.log(1.15)] = -1e12
    back = np.zeros(sal.shape, dtype=int)
    for t in range(1, len(sal)):
        cand = score[:, None] - jump
        back[t] = np.argmax(cand, axis=0)
        score = cand[back[t], np.arange(len(grid))] + sal[t]
    path = np.zeros(len(sal), dtype=int)
    path[-1] = int(np.argmax(score))
    for t in range(len(sal) - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    times = (np.array(frames) + win / 2) / SR
    return times, grid[path], sal[np.arange(len(sal)), path]


def order_frames(x, times, rpm, revs=20, samples_per_rev=512, hop_revs=5, zpad=4):
    """Resample to the crank-angle domain and read per-order power."""
    t = np.arange(len(x)) / SR
    rpm_t = np.interp(t, times, rpm)
    angle = np.cumsum(rpm_t / 60 / SR)  # revolutions
    uniform = np.arange(angle[0], angle[-1], 1 / samples_per_rev)
    xa = np.interp(uniform, angle, x)
    ta = np.interp(uniform, angle, t)
    M = revs * samples_per_rev
    N = M * zpad
    w = np.blackman(M)
    w /= w.sum()
    out = []
    bin_per_order = revs * zpad  # order h sits at bin h·P·z
    for s in range(0, len(xa) - M, hop_revs * samples_per_rev):
        seg = xa[s:s + M]
        p = np.abs(np.fft.rfft(seg * w, N)) ** 2
        mid_t = ta[s + M // 2]
        r = float(np.interp(mid_t, times, rpm))
        # Audio-band limit in orders for this speed.
        max_order = min(ORDERS[-1], 0.45 * SR / (r / 60))
        total = p[int(0.25 * bin_per_order): int(max_order * bin_per_order)].sum()
        half = int(0.15 * bin_per_order)
        lv = []
        for h in ORDERS:
            b = int(round(h * bin_per_order))
            lv.append(p[b - half:b + half + 1].sum() if h <= max_order else 0.0)
        lv = np.array(lv)
        out.append({
            "t": round(float(mid_t), 3),
            "rpm": round(r, 1),
            "total_db": round(float(10 * np.log10(total + 1e-30)), 2),
            "orders_rel_db": [round(float(10 * np.log10(v / total + 1e-12)), 2) for v in lv],
            "order_share": round(float(lv.sum() / (total + 1e-30)), 4),
        })
    return out


def steady_rpm(x, rpm_approx, fire):
    """Constant speed from the dominant order's peak within ±12 % of the expected frequency."""
    from scipy.signal import welch
    f, p = welch(x, SR, nperseg=1 << 16)
    f0 = fire * rpm_approx / 60
    m = (f > f0 / 1.12) & (f < f0 * 1.12)
    i = np.argmax(p[m])
    fi = f[m]
    # Parabolic refinement on the log spectrum.
    lp = np.log(p[m] + 1e-30)
    if 0 < i < len(lp) - 1:
        d = 0.5 * (lp[i - 1] - lp[i + 1]) / (lp[i - 1] - 2 * lp[i] + lp[i + 1])
        fpk = fi[i] + d * (fi[1] - fi[0])
    else:
        fpk = fi[i]
    return fpk * 60 / fire


def analyse(args):
    x = decode(args.audio)
    x = x - x.mean()
    if args.t0 is not None or args.t1 is not None:
        x = x[int((args.t0 or 0) * SR): int(args.t1 * SR) if args.t1 else None]
    if args.steady:
        r = steady_rpm(x, args.rpm_start, args.fire_order or args.cylinders / 2)
        times, rpm = np.array([0.0, len(x) / SR]), np.array([r, r])
    elif args.rpm_track:
        tr = json.load(open(args.rpm_track))
        times, rpm = np.array(tr["t"], dtype=float), np.array(tr["rpm"], dtype=float)
    else:
        times, rpm, _ = track_rpm(x, args.rpm_min, args.rpm_max, args.cylinders, args.rpm_start, args.fire_order, args.max_step)
    frames = order_frames(x, times, rpm)
    res = {"source": args.audio, "orders": ORDERS.tolist(), "rpm_track": {"t": times.round(3).tolist(), "rpm": rpm.round(1).tolist()}, "frames": frames}
    json.dump(res, open(args.out, "w"))
    r = np.array([f["rpm"] for f in frames])
    print(f"{args.audio}: {len(frames)} frames, rpm {r.min():.0f}–{r.max():.0f}, mean order share {np.mean([f['order_share'] for f in frames]):.2f}")


def binned(data, edges):
    rows = {}
    for f in data["frames"]:
        k = np.searchsorted(edges, f["rpm"]) - 1
        if 0 <= k < len(edges) - 1:
            rows.setdefault(k, []).append(f)
    out = {}
    for k, fs in rows.items():
        out[k] = {
            "rpm": float(np.mean([f["rpm"] for f in fs])),
            "orders": np.mean([f["orders_rel_db"] for f in fs], axis=0),
            "total": float(np.mean([f["total_db"] for f in fs])),
            "share": float(np.mean([f["order_share"] for f in fs])),
        }
    return out


def compare(args):
    a, b = json.load(open(args.recording)), json.load(open(args.render))
    edges = np.arange(500, 15000, args.bin)
    A, B = binned(a, edges), binned(b, edges)
    common = sorted(set(A) & set(B))
    if not common:
        print("no overlapping rpm range")
        return
    rows, errs = [], []
    for k in common:
        oa, ob = A[k]["orders"], B[k]["orders"]
        strong = np.maximum(oa, ob) > -30  # orders carrying at least 0.1 % of the energy
        err = float(np.mean(np.abs(oa[strong] - ob[strong])))
        corr = float(np.corrcoef(oa[strong], ob[strong])[0, 1]) if strong.sum() > 2 else float("nan")
        errs.append(err)
        top_a = [float(o) for o in np.array(a["orders"])[np.argsort(-oa)[:4]]]
        top_b = [float(o) for o in np.array(b["orders"])[np.argsort(-ob)[:4]]]
        rows.append({"rpm": round(A[k]["rpm"]), "order_err_db": round(err, 2), "profile_corr": round(corr, 3),
                     "order_share": [round(A[k]["share"], 3), round(B[k]["share"], 3)], "top_orders": [top_a, top_b]})
    ra = np.array([A[k]["rpm"] for k in common])
    slope = lambda D: float(np.polyfit(np.log2(ra), [D[k]["total"] for k in common], 1)[0]) if len(common) > 2 else float("nan")
    summary = {"bins": rows, "mean_order_err_db": round(float(np.mean(errs)), 2),
               "loudness_db_per_rpm_doubling": [round(slope(A), 1), round(slope(B), 1)]}
    print(f"{'rpm':>6} {'order err dB':>12} {'corr':>6} {'order share rec/sim':>20}  top orders rec | sim")
    for r in rows:
        print(f"{r['rpm']:6} {r['order_err_db']:12} {r['profile_corr']:6} {r['order_share'][0]:>9}/{r['order_share'][1]:<9}  {r['top_orders'][0]} | {r['top_orders'][1]}")
    print(f"mean order-profile error {summary['mean_order_err_db']} dB; loudness slope rec/sim {summary['loudness_db_per_rpm_doubling']} dB per rpm doubling")
    if args.png:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 3, figsize=(15, 4.5), sharey=True)
        orders = np.array(a["orders"])
        lo, hi = (ra[0], ra[-1]) if ra[-1] > ra[0] else (ra[0] - args.bin / 2, ra[0] + args.bin / 2)
        for i, (D, title) in enumerate([(A, "recording"), (B, "render")]):
            img = np.array([D[k]["orders"] for k in common]).T
            ax[i].imshow(img, aspect="auto", origin="lower", vmin=-40, vmax=0, cmap="magma",
                         extent=[lo, hi, orders[0], orders[-1]])
            ax[i].set_title(f"{title}: order level re frame total (dB)")
            ax[i].set_xlabel("rpm")
        ax[0].set_ylabel("engine order")
        diff = np.array([B[k]["orders"] - A[k]["orders"] for k in common]).T
        im = ax[2].imshow(diff, aspect="auto", origin="lower", vmin=-15, vmax=15, cmap="coolwarm",
                          extent=[lo, hi, orders[0], orders[-1]])
        ax[2].set_title("render − recording (dB)")
        ax[2].set_xlabel("rpm")
        fig.colorbar(im, ax=ax[2])
        fig.tight_layout()
        fig.savefig(args.png, dpi=110)
    if args.out:
        json.dump(summary, open(args.out, "w"), indent=1)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyse")
    a.add_argument("audio")
    a.add_argument("--out", required=True)
    a.add_argument("--cylinders", type=int, required=True, help="cylinder count (four-stroke firing order = n/2)")
    a.add_argument("--fire-order", type=float, help="dominant engine order if not n/2 (odd-fire, twins, 90° V10/V6)")
    a.add_argument("--rpm-start", type=float, help="approximate speed at the start of the file (anchors the track)")
    a.add_argument("--rpm-track", help="JSON {t: [...], rpm: [...]} with the known speed (renders); skips tracking")
    a.add_argument("--t0", type=float, help="segment start (s)")
    a.add_argument("--t1", type=float, help="segment end (s)")
    a.add_argument("--steady", action="store_true", help="constant-speed segment: speed from the dominant order's peak near --rpm-start")
    a.add_argument("--max-step", type=float, help="hard per-50 ms speed-change limit, e.g. 0.03 for slow dyno pulls")
    a.add_argument("--rpm-min", type=float, default=500)
    a.add_argument("--rpm-max", type=float, default=9000)
    c = sub.add_parser("compare")
    c.add_argument("recording")
    c.add_argument("render")
    c.add_argument("--bin", type=float, default=250)
    c.add_argument("--png")
    c.add_argument("--out")
    args = p.parse_args()
    analyse(args) if args.cmd == "analyse" else compare(args)


if __name__ == "__main__":
    main()
