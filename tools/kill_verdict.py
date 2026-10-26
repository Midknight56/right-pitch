"""Day 1 kill test verdict: reads .qloo-raw/ and prints only counts and pass or fail per line of the plan."""
import json
import pathlib
import statistics

RAW = pathlib.Path(__file__).resolve().parent.parent / ".qloo-raw"


def ents(label):
    f = RAW / f"{label}.json"
    if not f.exists():
        return []
    d = json.loads(f.read_text())
    return (d["body"] or {}).get("results", {}).get("entities", []) if d["status"] == 200 else []


def pool(prefixes):
    seen = {}
    for p in prefixes:
        for f in sorted(RAW.glob(p + "*.json")):
            for e in ents(f.stem):
                seen[e["entity_id"]] = e
    return seen


def prop(e, k):
    v = (e.get("properties") or {}).get(k)
    return None if v in (None, "", []) else v


def imdb(e):
    x = (e.get("external") or {}).get("imdb") or [{}]
    return x[0].get("user_rating")


lines = []

def check(name, ok, detail):
    lines.append((name, "PASS" if ok else "FAIL", detail))


# 1. Field coverage on the plan's sample sizes (first 40 movies, 30 TV, 30 books, 20 people, 20 places).
cov = {
    "movie release_year": ([e for e in pool(["cov_movie"]).values()][:40], lambda e: prop(e, "release_year")),
    "tv_show release_year": ([e for e in pool(["cov_tv_show"]).values()][:30], lambda e: prop(e, "release_year")),
    "book publication_year": ([e for e in pool(["cov_book"]).values()][:30], lambda e: prop(e, "publication_year")),
    "person date_of_birth": ([e for e in pool(["cov_person"]).values()][:20], lambda e: prop(e, "date_of_birth")),
    "place business_rating": ([e for e in pool(["cov_place"]).values()][:20], lambda e: prop(e, "business_rating")),
    "movie imdb rating": ([e for e in pool(["cov_movie"]).values()][:40], imdb),
}
for name, (es, f) in cov.items():
    n = sum(1 for e in es if f(e) is not None)
    check(f"coverage {name}", n >= 0.85 * len(es), f"{n}/{len(es)}")

# 2. Popularity present on every result of every call.
all_ents = [e for f in RAW.glob("*.json") if f.stem not in ("calls",) and not f.stem.startswith(("agepool", "odd_plan"))
            for e in ents(f.stem)]
withpop = sum(1 for e in all_ents if isinstance(e.get("popularity"), (int, float)))
check("popularity on every result", withpop == len(all_ents), f"{withpop}/{len(all_ents)} results")

# 3. Age lens: rank gap of 0.15 or more between the youngest and the oldest crowd, on one fixed set.
gap_total = 0
for t in ["movie", "tv_show", "artist"]:
    young, old = ents(f"age_{t}_24_and_younger"), ents(f"age_{t}_55_and_older")
    if not young or not old:
        continue
    # Measured 25 Oct 2026: with only a crowd signal Qloo returns the set in popularity order in both lenses, so the
    # rank inside each lens comes from sorting by affinity here.
    young = sorted(young, key=lambda e: -e["query"]["affinity"])
    old = sorted(old, key=lambda e: -e["query"]["affinity"])
    n = len(young)
    ry = {e["entity_id"]: i / (n - 1) for i, e in enumerate(young)}
    ro = {e["entity_id"]: i / (len(old) - 1) for i, e in enumerate(old)}
    gaps = [abs(ry[k] - ro[k]) for k in ry if k in ro]
    big = sum(1 for g in gaps if g >= 0.15)
    gap_total += big
    ay = {e["entity_id"]: e["query"]["affinity"] for e in young}
    ao = {e["entity_id"]: e["query"]["affinity"] for e in old}
    aff_gaps = [abs(ay[k] - ao[k]) for k in ay if k in ao]
    lines.append((f"  age lens {t}", "", f"{big} of {len(gaps)} items move 0.15 or more in rank; mean rank gap "
                  f"{statistics.mean(gaps):.2f}; mean affinity gap {statistics.mean(aff_gaps):.3f}"))
check("age lens rank gap >= 0.15 on 10+ items", gap_total >= 10, f"{gap_total} items across 3 types")

# 4. Popularity spread inside a band when a signal ranks by affinity.
b = [e["popularity"] for e in ents("band_movie_sig")]
if b:
    inside = sum(1 for p in b if 0.5 <= p <= 0.8)
    lines.append(("  band 0.5 to 0.8 with a signal", "", f"{inside}/{len(b)} inside; spread {min(b):.3f} to {max(b):.3f}, "
                  f"mean {statistics.mean(b):.3f}"))

# 5. Template types with 200 or more distinct items that carry the field the template needs.
templates = {
    "movie release year": (pool(["cov_movie", "dec_movie", "band_movie", "loc_halifax_movies", "age_movie"]),
                           lambda e: prop(e, "release_year")),
    "movie imdb rating (higher or lower)": (pool(["cov_movie", "dec_movie", "band_movie", "loc_halifax_movies", "age_movie"]), imdb),
    "tv show first year": (pool(["cov_tv_show", "dec_tv_show", "age_tv_show", "sup_tv_show"]), lambda e: prop(e, "release_year")),
    "book publication year": (pool(["cov_book", "dec_book", "sup_book"]), lambda e: prop(e, "publication_year")),
    "person born first": (pool(["cov_person", "dec_person", "sup_person"]), lambda e: prop(e, "date_of_birth")),
    "artist start year": (pool(["cov_artist", "dec_artist", "age_artist", "sup_artist"]), lambda e: prop(e, "start_year")),
    "local place (Halifax plus Toronto)": (pool(["cov_place", "loc_halifax_p2", "loc_halifax_pubs", "sup_place"]), lambda e: prop(e, "business_rating")),
}
viable = 0
for name, (p, f) in templates.items():
    n = sum(1 for e in p.values() if f(e) is not None)
    ok = n >= 200
    viable += ok
    lines.append((f"  template {name}", "ok" if ok else "short", f"{n} distinct items with the field"))
check("5+ template types with 200+ distinct items", viable >= 5, f"{viable} of {len(templates)}")

calls = json.loads((RAW / "calls.json").read_text())["count"]
for name, verdict, detail in lines:
    print(f"{verdict:5s} {name}: {detail}")
print(f"Qloo calls used: {calls} of 60")
