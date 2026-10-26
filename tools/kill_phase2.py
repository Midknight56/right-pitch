"""Day 1 kill test, phase 2: decade spread, the age lens rank gap, popularity spread inside a band with a signal,
the local round and odd one out. Uses tools/qloo_raw.call, so the 60 call cap holds."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qloo_raw import RAW, call  # noqa: E402

I = "/v2/insights"


def ents(label):
    d = json.loads((RAW / f"{label}.json").read_text())
    return (d["body"] or {}).get("results", {}).get("entities", []) if d["status"] == 200 else []


def run(label, **params):
    if (RAW / f"{label}.json").exists():
        return  # already asked: a rerun costs nothing
    params = {k.replace("__", "."): str(v) for k, v in params.items()}
    out = call(label, I, params)
    print(label, out["status"], len(((out["body"] or {}).get("results") or {}).get("entities", []) or []))


T = "urn:entity:"
# Decade spread for the movie year round (popular enough for a pub: 0.8 and up).
for lo, hi in [(1970, 1979), (1980, 1989), (1990, 1999), (2000, 2009), (2010, 2019)]:
    run(f"dec_movie_{lo}", filter__type=T + "movie", filter__release_year__min=lo, filter__release_year__max=hi,
        filter__popularity__min=0.8, take=50)
for lo, hi in [(1980, 1999), (2000, 2014)]:
    run(f"dec_tv_show_{lo}", filter__type=T + "tv_show", filter__release_year__min=lo, filter__release_year__max=hi,
        filter__popularity__min=0.8, take=50)
for lo, hi in [(1900, 1979), (1980, 2009)]:
    run(f"dec_book_{lo}", filter__type=T + "book", filter__publication_year__min=lo, filter__publication_year__max=hi,
        filter__popularity__min=0.8, take=50)
for lo, hi in [("1940-01-01", "1969-12-31"), ("1970-01-01", "1999-12-31")]:
    run(f"dec_person_{lo[:4]}", filter__type=T + "person", filter__date_of_birth__min=lo, filter__date_of_birth__max=hi,
        filter__popularity__min=0.8, take=50)
# Artists have start_year but no documented year filter: two crowd signals give a wider pool.
run("dec_artist_young", filter__type=T + "artist", signal__demographics__age="24_and_younger", filter__popularity__min=0.8, take=50)
run("dec_artist_old", filter__type=T + "artist", signal__demographics__age="55_and_older", filter__popularity__min=0.8, take=50)

# Popularity spread inside a band once a signal ranks by affinity (no signal sorts by popularity, so every result sat
# at the band's top edge in phase 1).
run("band_movie_sig", filter__type=T + "movie", filter__popularity__min=0.5, filter__popularity__max=0.8,
    signal__demographics__age="35_to_44", take=50)

# The age lens: one fixed set scored under the youngest and the oldest crowd.
for t, src in [("movie", ["cov_movie_hi", "dec_movie_1980"]), ("tv_show", ["cov_tv_show_hi", "dec_tv_show_1980"]),
               ("artist", ["cov_artist_hi", "dec_artist_old"])]:
    pool = []
    for s in src:
        for e in ents(s):
            if e["entity_id"] not in pool:
                pool.append(e["entity_id"])
    pool = pool[:40]
    (RAW / f"agepool_{t}.json").write_text(json.dumps(pool))
    for age in ["24_and_younger", "55_and_older"]:
        run(f"age_{t}_{age}", filter__type=T + t, filter__results__entities=",".join(pool),
            signal__demographics__age=age, take=50)

# The local round: page 2 of Halifax, plus pubs only, plus Halifax as a taste signal for movies.
run("loc_halifax_p2", filter__type=T + "place", filter__location__query="Halifax", take=50, page=2)
run("loc_halifax_pubs", filter__type=T + "place", filter__location__query="Halifax",
    filter__tags="urn:tag:genre:place:pub", take=50)
run("loc_halifax_movies", filter__type=T + "movie", signal__location__query="Halifax", filter__popularity__min=0.7, take=50)

# Odd one out: seed with two films, score four candidates with explainability on.
hi = ents("cov_movie_hi")
anim = [e for e in hi if "Animation" in e["properties"].get("genres", []) or "Family" in e["properties"].get("genres", [])]
horror = [e for e in hi if "Horror" in e["properties"].get("genres", [])]
if len(anim) >= 4 and horror:
    seeds = [anim[0]["entity_id"], anim[1]["entity_id"]]
    cands = [anim[2]["entity_id"], anim[3]["entity_id"], horror[0]["entity_id"]]
    (RAW / "odd_plan.json").write_text(json.dumps({"seeds": seeds, "cands": cands, "odd": horror[0]["entity_id"]}))
    run("odd_movie", filter__type=T + "movie", signal__interests__entities=",".join(seeds),
        filter__results__entities=",".join(cands), feature__explainability="true", take=10)
else:
    print("odd one out: not enough animated or horror films in the pool", len(anim), len(horror))
