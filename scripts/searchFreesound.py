"""Search Freesound's public web pages (no API key) for candidate reference recordings.

    python3 scripts/searchFreesound.py out.json "diesel engine idle" "rx7 rotary" ...

For each query it reads the first results page, then each sound page, and records the title,
description, tags, licence, duration, sample rate and the public high-quality preview URL. Previews
(-hq.ogg / -hq.mp3, ~128-192 kbit/s) need no login and are what scripts/fetchReferenceAudio.py
downloads; they are fine for order tracking below ~15 kHz.

Licence policy for this repository: CC0 and CC-BY recordings may be committed (CC-BY with
attribution in the manifest). Anything else (NonCommercial, Sampling+) may be measured locally
but is never committed or shipped.
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (EngineSS reference search)"}


def get(url: str) -> str:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            time.sleep(2 ** attempt)
    return ""


def visible_text(page: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub("<[^>]+>", "\n", t)))


LICENCES = [
    ("Creative Commons 0", "CC0-1.0", True),
    ("Attribution NonCommercial", "CC-BY-NC", False),
    ("Attribution 4.0", "CC-BY-4.0", True),
    ("Attribution 3.0", "CC-BY-3.0", True),
    ("Attribution", "CC-BY", True),
    ("Sampling+", "Sampling+", False),
]


def sound(url: str) -> dict:
    page = get(url)
    text = visible_text(page)
    m = re.search(r'data-ogg="([^"]+)"', page)
    preview = m.group(1).replace("-lq.", "-hq.") if m else None
    title = re.search(r'og:audio:title" content="([^"]*)"', page)
    title = html.unescape(title.group(1)) if title else ""
    licence, committable = "unknown", False
    for label, spdx, ok in LICENCES:
        if label in text:
            licence, committable = spdx, ok
            break
    creator = re.search(r'og:audio:artist" content="([^"]*)"', page)
    # Description: between the category breadcrumb and "Sound illegal or offensive?".
    desc = ""
    m = re.search(r"Sound effects > [^>]*?(?: [A-Z][a-z]+)? (.*?) Sound illegal or offensive", text)
    if m:
        desc = m.group(1).strip()
    tags = re.findall(r'href="/browse/tags/([^"/]+)/"', page)
    dur = re.search(r"Duration (\d+):(\d+(?:\.\d+)?)", text)
    sr = re.search(r"Sample rate ([\d.]+) Hz", text)
    return {
        "source_url": url,
        "title": title,
        "creator": creator.group(1) if creator else "",
        "licence": licence,
        "committable": committable,
        "duration_s": int(dur.group(1)) * 60 + float(dur.group(2)) if dur else None,
        "sample_rate": float(sr.group(1)) if sr else None,
        "tags": tags,
        "description": desc[:600],
        "preview": preview,
    }


def search(query: str, pages: int = 1) -> list[str]:
    urls: list[str] = []
    for p in range(1, pages + 1):
        q = urllib.parse.urlencode({"q": query, "page": p})
        page = get(f"https://freesound.org/search/?{q}")
        for path in re.findall(r'href="(/people/[^/"]+/sounds/\d+/)"', page):
            u = "https://freesound.org" + path
            if u not in urls:
                urls.append(u)
    return urls


if __name__ == "__main__":
    out, queries = sys.argv[1], sys.argv[2:]
    seen: dict[str, dict] = {}
    for q in queries:
        for u in search(q):
            if u in seen:
                seen[u]["queries"].append(q)
                continue
            s = sound(u)
            s["queries"] = [q]
            seen[u] = s
            print(f"{s['licence']:10} {s['duration_s'] or 0:6.1f}s  {s['title'][:70]:70}  {u}", flush=True)
    json.dump(list(seen.values()), open(out, "w"), indent=1)
    print(f"{len(seen)} sounds -> {out}")
