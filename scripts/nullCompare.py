"""Compare two scripts/nullTest.ts renders: residual level of (b - a) relative to a, overall and in bands.

    python3 scripts/nullCompare.py a.f32 b.f32 [rate]
"""
import sys
import numpy as np

a = np.fromfile(sys.argv[1], "<f4").astype(float)
b = np.fromfile(sys.argv[2], "<f4").astype(float)
rate = int(sys.argv[3]) if len(sys.argv) > 3 else 48000
n = min(len(a), len(b))
a, b = a[:n], b[:n]
d = b - a
db = lambda x, y: 10 * np.log10((x ** 2).sum() / max(1e-30, (y ** 2).sum()))
print(f"residual {db(d, a):6.1f} dB re signal; peak residual {np.abs(d).max():.2e} (signal peak {np.abs(a).max():.2e})")
for name, t0, t1 in [("idle", 0.2, 1), ("free rev", 1, 2), ("dyno", 2, 3.5), ("lift-off", 3.5, 4.5)]:
    s = slice(int(t0 * rate), int(t1 * rate))
    print(f"  {name:9} {db(d[s], a[s]):6.1f} dB")
