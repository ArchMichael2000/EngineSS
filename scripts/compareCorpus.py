"""Run every recording-vs-simulation comparison in shared/ess/reference/recording-comparisons.json.

    python3 scripts/compareCorpus.py <out-dir> [case-id ...]

For each case: analyse the recording segment (scripts/compareRecording.py), render the matching
reference engine at the same condition from each listener perspective (scripts/renderForCompare.ts:
`idle`, or `replay` of the recording's own speed track), analyse the renders on their exact speed
tracks, and compare. Prints one row per case and perspective and writes <out-dir>/summary.json plus a
comparison figure per case and perspective. Hobby recordings carry no microphone position, so every
perspective is reported; the best one says where the microphone probably was, not that the model
is right.

Metrics, per 400 rpm bin and then averaged:
  error     mean |order level re frame total| difference, orders 0.5–32 (dB)
  offfire   share of order energy (orders ≤ 24) on non-firing orders, recording / render (dB)
  tilt      broadband spectral tilt, energy 2–8 kHz over 0.1–1 kHz, recording / render (dB)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT / "shared/ess/reference/recording-comparisons.json").read_text())["cases"]


def run(cmd: list[str], env=None) -> str:
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return r.stdout


def offfire_db(path: Path, fire: float) -> float:
    d = json.loads(path.read_text())
    orders = np.array(d["orders"])
    levels = np.array([f["orders_rel_db"] for f in d["frames"]])
    mean = (10 ** (levels / 10)).mean(0)
    firing = np.isclose(np.mod(orders + 1e-9, fire), 0, atol=1e-6) | np.isclose(np.mod(orders + 1e-9, fire), fire, atol=1e-6)
    sel = orders <= 24
    return float(10 * np.log10(mean[sel & ~firing].sum() / mean[sel].sum()))


def band_ratio_db(path: str, t0: float, t1: float | None, highpass: float | None) -> float:
    """Spectral tilt: energy 2–8 kHz over 0.1–1 kHz (dB), after the case's recording-chain high-pass."""
    from scipy.signal import butter, sosfiltfilt, welch
    cmd = ["ffmpeg", "-v", "error", "-ss", str(t0)] + (["-t", str(t1 - t0)] if t1 else []) + ["-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, "<f4").astype(float)
    if highpass:
        x = sosfiltfilt(butter(4, highpass, "highpass", fs=48000, output="sos"), x)
    f, p = welch(x, 48000, nperseg=8192)
    return float(10 * np.log10(p[(f >= 2000) & (f <= 8000)].sum() / p[(f >= 100) & (f <= 1000)].sum()))


def main() -> None:
    out = Path(sys.argv[1]).resolve()
    only = set(sys.argv[2:])
    out.mkdir(parents=True, exist_ok=True)
    summary = []
    for case in CASES:
        if only and case["id"] not in only:
            continue
        cid = case["id"]
        fire = case.get("fire_order", case["cylinders"] / 2)
        rec_json = out / f"{cid}-rec.json"
        a = ["python3", "scripts/compareRecording.py", "analyse", case["recording"], "--cylinders", str(case["cylinders"]), "--out", str(rec_json),
             "--t0", str(case["t0"]), "--t1", str(case["t1"]), "--rpm-min", str(case.get("rpm_min", 400)), "--rpm-max", str(case.get("rpm_max", 9000))]
        if "fire_order" in case:
            a += ["--fire-order", str(case["fire_order"])]
        if "rpm_start" in case:
            a += ["--rpm-start", str(case["rpm_start"])]
        if case["mode"] == "idle":
            a += ["--steady"]
        if "max_step" in case:
            a += ["--max-step", str(case["max_step"])]
        hp = ["--highpass", str(case["highpass_hz"])] if "highpass_hz" in case else []
        a += hp
        run(a)
        rec_off = offfire_db(rec_json, fire)
        rec_tilt = band_ratio_db(case["recording"], case["t0"], case["t1"], case.get("highpass_hz"))
        rows = []
        for persp in case.get("perspectives", ["exterior-rear", "exterior-side", "engine-bay"]):
            prefix = out / f"{cid}-{persp}"
            r = ["npx", "vite-node", "scripts/renderForCompare.ts", "--", case["engine"], persp]
            r += ["idle", "12", str(prefix)] if case["mode"] == "idle" else ["replay", str(rec_json), str(prefix)]
            import os
            env = {**os.environ}
            if "patch" in case:
                env["PATCH"] = json.dumps(case["patch"])
            if "replay_throttle" in case:
                env["REPLAY_THROTTLE"] = str(case["replay_throttle"])
            run(r, env)
            sim_json = out / f"{cid}-{persp}-sim.json"
            b = ["python3", "scripts/compareRecording.py", "analyse", f"{prefix}.wav", "--cylinders", str(case["cylinders"]), "--rpm-track", f"{prefix}.track.json", "--out", str(sim_json)]
            if "fire_order" in case:
                b += ["--fire-order", str(case["fire_order"])]
            if case["mode"] == "idle":
                b += ["--t0", "2"]
            run(b + hp)
            txt = run(["python3", "scripts/compareRecording.py", "compare", str(rec_json), str(sim_json), "--bin", "400", "--png", f"{prefix}.png"])
            m = re.search(r"mean order-profile error ([\d.]+|nan) dB", txt)
            err = float(m.group(1)) if m else float("nan")
            sim_off = offfire_db(sim_json, fire)
            sim_tilt = band_ratio_db(f"{prefix}.wav", 2 if case["mode"] == "idle" else 0, None, case.get("highpass_hz"))
            rows.append({"perspective": persp, "error_db": err, "offfire_rec_db": rec_off, "offfire_sim_db": sim_off, "tilt_rec_db": rec_tilt, "tilt_sim_db": sim_tilt})
            print(f"{cid:28} {persp:14} error {err:5.1f} dB   off-firing rec {rec_off:6.1f} / sim {sim_off:6.1f} dB   2-8k/0.1-1k rec {rec_tilt:6.1f} / sim {sim_tilt:6.1f} dB", flush=True)
        best = min(rows, key=lambda x: x["error_db"] if x["error_db"] == x["error_db"] else 1e9)
        summary.append({**{k: case[k] for k in ("id", "recording", "engine", "mode", "t0", "t1")}, "results": rows, "best": best})
    (out / "summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
