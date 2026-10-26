"""Raw Qloo calls for the Day 1 kill test. Every answer is saved whole under .qloo-raw/ (git ignores it: Qloo's
guide says its response data must not go in a public repo). A hard cap of 60 calls is kept in .qloo-raw/calls.json
across runs, so the test can never spend more than the plan allows.

Usage: python tools/qloo_raw.py <label> <path> key=value ...   (one call, prints a short summary)
"""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / ".qloo-raw"
KEY_FILE = pathlib.Path(r"C:\Users\User\.cloudflare\qloo-hackathon-api-key.local.txt")
BASE = "https://hackathon.api.qloo.com"
CAP = 60


def key() -> str:
    return KEY_FILE.read_text(encoding="utf-8-sig").splitlines()[0].strip()


def ledger() -> dict:
    f = RAW / "calls.json"
    return json.loads(f.read_text()) if f.exists() else {"count": 0, "calls": []}


def call(label: str, path: str, params: dict) -> dict:
    RAW.mkdir(exist_ok=True)
    book = ledger()
    if book["count"] >= CAP:
        raise SystemExit(f"cap reached: {book['count']} of {CAP} calls used")
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"X-Api-Key": key(), "Accept": "application/json"})
    started = time.time()
    status, headers, body = 0, {}, None
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            status, headers = res.status, dict(res.headers)
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        status, headers = e.code, dict(e.headers)
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = None
    book["count"] += 1
    book["calls"].append({"label": label, "path": path, "params": params, "status": status,
                          "ms": round((time.time() - started) * 1000)})
    (RAW / "calls.json").write_text(json.dumps(book, indent=1))
    rate = {k: v for k, v in headers.items() if "rate" in k.lower() or "limit" in k.lower() or "quota" in k.lower()}
    out = {"label": label, "path": path, "params": params, "status": status, "rate_headers": rate, "body": body}
    (RAW / f"{label}.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    label, path, *pairs = sys.argv[1:]
    params = dict(p.split("=", 1) for p in pairs)
    out = call(label, path, params)
    body = out["body"] or {}
    ents = (body.get("results") or {}).get("entities") if isinstance(body.get("results"), dict) else body.get("results")
    print(out["status"], "rate:", out["rate_headers"], "results:", len(ents or []), "calls used:", ledger()["count"])
    if out["status"] != 200:
        print(json.dumps(body)[:600])
