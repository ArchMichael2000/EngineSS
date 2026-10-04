"""Download the CC0 real-engine recordings listed in shared/ess/reference/real-audio-manifest.json
into reference-audio/, verifying each file's SHA-256 against the manifest.

    python3 scripts/fetchReferenceAudio.py
"""
import hashlib, json, os, sys, urllib.request

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
manifest = json.load(open(os.path.join(root, "shared/ess/reference/real-audio-manifest.json")))
out_dir = os.path.join(root, "reference-audio")
os.makedirs(out_dir, exist_ok=True)
failed = 0
for rec in manifest["recordings"]:
    path = os.path.join(out_dir, rec["file"])
    if not os.path.exists(path):
        req = urllib.request.Request(rec["url"], headers={"User-Agent": "EngineSS-reference-fetch"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        open(path, "wb").write(data)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    ok = digest == rec["sha256"]
    failed += not ok
    print(f"{'ok ' if ok else 'BAD'} {rec['key']:10} {rec['file']} {os.path.getsize(path)} bytes")
sys.exit(1 if failed else 0)
