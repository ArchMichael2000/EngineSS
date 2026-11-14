"""Spectrogram contact sheet of rendered clips.

    python3 scripts/plotSpectrograms.py out.png "Title 1=a.wav" "Title 2=b.wav" ... [--fmax 1200] [--cols 2]

Each panel shows 0..fmax Hz on a linear axis (firing orders are the horizontal ladders) with the
level in dB relative to the clip's own peak bin, and the waveform envelope underneath.
"""
import sys
import wave

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.signal import spectrogram

args = sys.argv[1:]
fmax = 1200.0
cols = 2
items = []
out = args.pop(0)
while args:
    a = args.pop(0)
    if a == "--fmax":
        fmax = float(args.pop(0))
    elif a == "--cols":
        cols = int(args.pop(0))
    else:
        title, path = a.split("=", 1)
        items.append((title, path))

rows = (len(items) + cols - 1) // cols
fig, axes = plt.subplots(rows, cols, figsize=(6.4 * cols, 3.1 * rows), squeeze=False, facecolor="#0b0d14")
for ax in axes.flat:
    ax.set_visible(False)
for ax, (title, path) in zip(axes.flat, items):
    ax.set_visible(True)
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0
    x = x.reshape(-1, ch).mean(axis=1)
    nper = 1 << int(np.ceil(np.log2(sr * 0.17)))
    f, t, s = spectrogram(x, fs=sr, nperseg=nper, noverlap=int(nper * 0.9), window="hann", mode="magnitude")
    keep = f <= fmax
    db = 20 * np.log10(s[keep] / s[keep].max() + 1e-9)
    ax.set_facecolor("#0b0d14")
    ax.pcolormesh(t, f[keep], db, vmin=-70, vmax=0, cmap="magma", shading="auto", rasterized=True)
    ax.set_title(title, color="#e6e8f0", fontsize=10, loc="left")
    ax.set_ylabel("Hz", color="#9aa0b4", fontsize=8)
    ax.set_xlabel("s", color="#9aa0b4", fontsize=8)
    ax.tick_params(colors="#9aa0b4", labelsize=7)
    for spine in ax.spines.values():
        spine.set_color("#2a2f45")
fig.tight_layout()
fig.savefig(out, dpi=110, facecolor=fig.get_facecolor())
print("wrote", out)
