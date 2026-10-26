"""Day 1 kill test, phase 3 (the written fallback): phases 1 and 2 asked for one page per query, so five templates
were short of 200 items by our own sampling, not by Qloo's supply. Ask for the next pages, and try odd one out with
seeds from the whole movie pool."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from kill_phase2 import T, ents, run  # noqa: E402  (phase 2's calls are already saved, so importing it costs nothing)
from qloo_raw import RAW  # noqa: E402

run("sup_tv_show_p2", filter__type=T + "tv_show", filter__release_year__min=2000, filter__release_year__max=2014,
    filter__popularity__min=0.8, take=50, page=2)
run("sup_book_p2", filter__type=T + "book", filter__publication_year__min=1980, filter__publication_year__max=2009,
    filter__popularity__min=0.8, take=50, page=2)
run("sup_person_1970_p2", filter__type=T + "person", filter__date_of_birth__min="1970-01-01",
    filter__date_of_birth__max="1999-12-31", filter__popularity__min=0.8, take=50, page=2)
run("sup_person_1940_p2", filter__type=T + "person", filter__date_of_birth__min="1940-01-01",
    filter__date_of_birth__max="1969-12-31", filter__popularity__min=0.8, take=50, page=2)
for p in (2, 3):
    run(f"sup_artist_hi_p{p}", filter__type=T + "artist", filter__popularity__min=0.95, take=50, page=p)
run("sup_artist_mid_p2", filter__type=T + "artist", filter__popularity__min=0.6, filter__popularity__max=0.85, take=50, page=2)
run("sup_place_halifax_p3", filter__type=T + "place", filter__location__query="Halifax", take=50, page=3)
run("sup_place_toronto", filter__type=T + "place", filter__location__query="Toronto", take=50)

# Odd one out from the whole movie pool: two animated seeds, two more animated candidates, one horror film.
movies = {}
for f in sorted(RAW.glob("*movie*.json")):
    if f.stem.startswith(("agepool", "odd")):
        continue
    for e in ents(f.stem):
        movies[e["entity_id"]] = e
anim = [e for e in movies.values() if "Animation" in e["properties"].get("genres", [])]
horror = [e for e in movies.values() if "Horror" in e["properties"].get("genres", [])]
print("pool", len(movies), "animation", len(anim), "horror", len(horror))
if len(anim) >= 4 and horror:
    seeds = [anim[0]["entity_id"], anim[1]["entity_id"]]
    cands = [anim[2]["entity_id"], anim[3]["entity_id"], horror[0]["entity_id"]]
    (RAW / "odd_plan.json").write_text(json.dumps({"seeds": seeds, "cands": cands, "odd": horror[0]["entity_id"]}))
    run("odd_movie", filter__type=T + "movie", signal__interests__entities=",".join(seeds),
        filter__results__entities=",".join(cands), feature__explainability="true", take=10)
