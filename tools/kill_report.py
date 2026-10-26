"""Reads the raw kill test answers in .qloo-raw/ and prints field coverage per entity type. Prints counts only, never
Qloo's data, so its output can go in a doc."""
import collections
import json
import pathlib
import sys

RAW = pathlib.Path(__file__).resolve().parent.parent / ".qloo-raw"

FIELDS = {
    "movie": ["properties.release_year", "properties.release_date", "properties.content_rating", "properties.duration",
              "external.imdb.0.user_rating", "external.metacritic.0.critic_rating", "external.rottentomatoes.0.critic_rating"],
    "tv_show": ["properties.release_year", "properties.finale_year", "properties.content_rating",
                "external.imdb.0.user_rating"],
    "book": ["properties.publication_year", "properties.publication_date", "properties.page_count", "properties.author",
             "external.goodreads.0.rating"],
    "person": ["properties.date_of_birth", "properties.date_of_death", "properties.place_of_birth", "properties.gender"],
    "artist": ["properties.date_of_birth", "properties.date_founded", "properties.date_formed", "properties.place_of_birth"],
    "place": ["properties.address", "properties.business_rating", "properties.price_level", "properties.geocode.city",
              "external.tripadvisor.0.rating"],
}


def dig(o, path):
    for part in path.split("."):
        if isinstance(o, list):
            o = o[int(part)] if part.isdigit() and len(o) > int(part) else None
        elif isinstance(o, dict):
            o = o.get(part)
        else:
            return None
    return o


def entities(prefix):
    seen = {}
    for f in sorted(RAW.glob(prefix + "*.json")):
        d = json.loads(f.read_text())
        res = (d.get("body") or {}).get("results") or {}
        for e in res.get("entities", []) if isinstance(res, dict) else []:
            seen[e["entity_id"]] = e
    return list(seen.values())


def keys_of(ents):
    c = collections.Counter()
    for e in ents:
        for k, v in (e.get("properties") or {}).items():
            if v not in (None, [], ""):
                c["properties." + k] += 1
        for k, v in (e.get("external") or {}).items():
            if v:
                sub = v[0] if isinstance(v, list) and v and isinstance(v[0], dict) else {}
                for sk in sub:
                    c[f"external.{k}.0.{sk}"] += 1
    return c


if __name__ == "__main__":
    prefix = sys.argv[1] if len(sys.argv) > 1 else "cov_"
    for t, fields in FIELDS.items():
        ents = entities(f"{prefix}{t}")
        if not ents:
            continue
        pop = sum(1 for e in ents if isinstance(e.get("popularity"), (int, float)))
        print(f"\n{t}: {len(ents)} distinct, popularity on {pop}")
        for fld in fields:
            n = sum(1 for e in ents if dig(e, fld) not in (None, "", []))
            print(f"  {fld:45s} {n:3d}/{len(ents)} = {100 * n / len(ents):.0f}%")
        if "-v" in sys.argv:
            for k, n in keys_of(ents).most_common(60):
                print(f"    have {k} {n}")
