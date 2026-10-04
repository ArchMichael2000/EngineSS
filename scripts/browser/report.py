"""Spectrogram contact sheet and level/rpm summary for a browser smoke run.

    python3 scripts/browser/report.py <smoke-out-dir> [figure.png]

Reads <dir>/results.json and <dir>/audio/<engine>.wav (written by smoke.mjs) and draws one
spectrogram per reference engine over the capture: 2 s idle, 2.5 s full throttle, 2 s lift-off.
"""
import json
import sys
import wave
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.signal import spectrogram

out = Path(sys.argv[1])
fig_path = Path(sys.argv[2]) if len(sys.argv) > 2 else out / "browser-engines.png"
results = json.loads((out / "results.json").read_text())
rows = results["engines"]


def read_wav(path: Path):
    with wave.open(str(path)) as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        data = data.reshape(-1, w.getnchannels())
    # One ear only: summing the two ears would comb-filter (each ear hears every source at a different delay).
    return sr, data[:, 0]


cols = 5
n = len(rows)
fig, axes = plt.subplots((n + cols - 1) // cols, cols, figsize=(cols * 3.6, ((n + cols - 1) // cols) * 2.6), sharex=True, sharey=True, constrained_layout=True)
axes = np.atleast_1d(axes).ravel()
for ax, row in zip(axes, rows):
    sr, x = read_wav(out / "audio" / f"{row['key']}.wav")
    f, t, s = spectrogram(x, fs=sr, nperseg=2048, noverlap=1536, window="hann")
    db = 10 * np.log10(s + 1e-14)
    ax.pcolormesh(t, f / 1000, db, shading="auto", cmap="magma", vmin=db.max() - 80, vmax=db.max())
    ax.set_ylim(0, 12)
    ax.axvline(2.0, color="w", lw=0.5, ls=":")
    ax.axvline(4.5, color="w", lw=0.5, ls=":")
    ax.set_title(f"{row['key']}\nidle {row['idleRpm']:.0f} · WOT {row['wotRpm']:.0f} rpm · {row['wotDb']:.0f} dBFS", fontsize=8)
    ax.tick_params(labelsize=7)
for ax in axes[n:]:
    ax.axis("off")
for ax in axes[::cols]:
    ax.set_ylabel("kHz", fontsize=7)
fig.suptitle(f"Browser capture of every reference engine (Chromium, {results['url']}): idle → full throttle → lift-off", fontsize=10)
fig.savefig(fig_path, dpi=72)
print(f"wrote {fig_path}")
