"""The measured claim: ask the same model with no tools for a HARD round, then read each item's Qloo popularity.

    python tools/claim_eval.py <rounds> [--kind film|telly|music]

For each round the model (Workers AI, the same model the app uses, no tools) is asked for five items for a hard pub quiz
round. Each item is looked up with Qloo's /search (one call each) and its popularity percentile is read. A household name
is popularity 0.97 or more, the app's "easy" band. Every model call is reserved in the shared hackathon ledger first
(73 neurons) and settled at its real cost; the run stops when the ledger refuses. Qloo calls count against nothing in the
app, so the run is capped here: at most 5 calls a round and 120 in all.

Prints counts only. The per item answers stay in .qloo-raw/claim/ (git ignores it).
"""
import json
import pathlib
import re
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qloo_raw import BASE as QLOO, key as qloo_key  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / ".qloo-raw" / "claim"
SECRETS = pathlib.Path(r"C:\Users\User\.cloudflare\hackathon-cf-account.local.txt")
MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
APP = "right-pitch"
DAILY_CAP, ACCOUNT_CAP, RESERVE = 450, 9500, 73
MAX_QLOO = 120
TYPES = {"film": "urn:entity:movie", "telly": "urn:entity:tv_show", "music": "urn:entity:artist"}
ASK = {
    "film": "films", "telly": "TV shows", "music": "music acts (bands or solo artists)",
}


def secrets():
    out = {}
    for line in SECRETS.read_text(encoding="utf-8-sig").splitlines():
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(\S+)", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


S = secrets()
CF = f"https://api.cloudflare.com/client/v4/accounts/{S['CLOUDFLARE_ACCOUNT_ID']}"
AUTH = {"Authorization": "Bearer " + S["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"}


def cf(path, body):
    req = urllib.request.Request(CF + path, data=json.dumps(body).encode(), headers=AUTH)
    return json.load(urllib.request.urlopen(req, timeout=60))


def d1(sql, params):
    r = cf(f"/d1/database/{S['HACKATHON_LEDGER_D1_ID']}/query", {"sql": sql, "params": params})
    return r["result"][0]["results"]


def reserve():
    day = time.strftime("%Y-%m-%d", time.gmtime())
    rows = d1("INSERT INTO ai_calls (app, day, neurons) SELECT ?, ?, ? WHERE (SELECT COALESCE(SUM(neurons),0) FROM ai_calls "
              "WHERE day = ? AND app = ?) + ? <= ? AND (SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE day = ?) + ? <= ? "
              "RETURNING id", [APP, day, RESERVE, day, APP, RESERVE, DAILY_CAP, day, RESERVE, ACCOUNT_CAP])
    return rows[0]["id"] if rows else None


def settle(row, neurons):
    d1("UPDATE ai_calls SET neurons = ? WHERE id = ?", [neurons, row])


def ask_model(kind):
    prompt = (f"Write a HARD round for a pub quiz: list exactly five {ASK[kind]} that only a real fan would know. "
              "One per line, the name only, no numbers, no years, no other words.")
    r = cf(f"/ai/run/{MODEL}", {"messages": [{"role": "user", "content": prompt}], "max_tokens": 200, "temperature": 0.7,
                                "chat_template_kwargs": {"enable_thinking": False}})
    res = r["result"]
    message = (res.get("choices") or [{}])[0].get("message", {})
    # With thinking off this model puts its answer in "reasoning" and leaves "content" null (seen 25 Oct 2026).
    text = message.get("content") or message.get("reasoning") or message.get("reasoning_content") or res.get("response") or ""
    text = re.sub(r"<think>[\s\S]*?</think>", "", text)
    names = [re.sub(r"^[\s\-*\d.)]+", "", line).strip().strip('"') for line in text.splitlines()]
    usage = res.get("usage") or {}
    neurons = usage.get("neurons") or (usage.get("prompt_tokens", 0) * 4625 + usage.get("completion_tokens", 0) * 30475) / 1e6
    return [n for n in names if n][:5], neurons


def popularity(name, kind):
    url = QLOO + "/search?" + urllib.parse.urlencode({"query": name, "types": TYPES[kind], "take": 1})
    req = urllib.request.Request(url, headers={"X-Api-Key": qloo_key(), "Accept": "application/json"})
    body = json.load(urllib.request.urlopen(req, timeout=20))
    res = body.get("results") or []
    return (res[0].get("name"), res[0].get("popularity")) if res else (None, None)


def main():
    import urllib.parse  # noqa: F401  (used by popularity)
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    kind = sys.argv[sys.argv.index("--kind") + 1] if "--kind" in sys.argv else "film"
    OUT.mkdir(parents=True, exist_ok=True)
    qloo_calls, items, household, found, neurons_total = 0, 0, 0, 0, 0.0
    for i in range(rounds):
        row = reserve()
        if row is None:
            print("the ledger refused: the day's share is spent; stopping")
            break
        try:
            names, neurons = ask_model(kind)
        except Exception:
            settle(row, 0)
            raise
        settle(row, neurons)
        neurons_total += neurons
        got = []
        for n in names:
            if qloo_calls >= MAX_QLOO:
                break
            qloo_calls += 1
            match, pop = popularity(n, kind)
            got.append({"asked": n, "match": match, "popularity": pop})
            items += 1
            if pop is not None:
                found += 1
                household += pop >= 0.97
        (OUT / f"{kind}-{int(time.time())}-{i}.json").write_text(json.dumps(got, indent=1))
    print(f"kind {kind}: {items} items asked for as HARD, {found} found in Qloo, {household} of them household names "
          f"(popularity 0.97 or more) = {100 * household / max(found, 1):.0f}%; {qloo_calls} Qloo calls, "
          f"{neurons_total:.1f} neurons")


if __name__ == "__main__":
    import urllib.parse  # noqa: F401
    main()
