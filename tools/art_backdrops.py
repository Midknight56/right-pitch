"""The 8 round card backdrops: Z-Image-Turbo (Apache 2.0) on the local art server, 2 seeds each, plus a contact sheet.

    <ComfyUI venv python> tools/art_backdrops.py [--seeds 2]

Writes to out/art/ (git ignores out/). The pick goes to public/art/ after the owner has seen the sheet.
The graph is the shipped image_z_image_turbo template, as in comfy-art-pipeline/gen_3d.py, with no LoRA.
"""
import os
import sys
import time

sys.path.insert(0, r"C:\Users\User\Tools\comfy-art-pipeline")
from comfy_pipeline import Comfy  # noqa: E402
from gen_3d import graph_concept_zimage  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out", "art")
STYLE = ("warm painterly illustration, soft brush texture, cosy evening light, deep shadows at the edges, a calm clear "
         "area in the middle, wide shot, no people, no faces, no text, no letters, no signs, no logos")
CARDS = {
    "lobby": "the inside of a friendly neighbourhood pub at night, wooden bar, glowing lamps, an empty chalkboard on the wall",
    "film": "an old film projector on a pub table throwing a beam of light through the dark, a bowl of popcorn",
    "telly": "a glowing vintage television set on a shelf in a cosy pub corner, a sofa and a pint glass",
    "books": "a snug pub corner with stacked old books, a green reading lamp, a cup of tea on a small table",
    "faces": "a pub wall covered in empty ornate gilt picture frames, warm wall lights, a dark wood panel",
    "music": "a small pub stage with a vinyl record player, a stack of records, an upright piano and a microphone stand",
    "generation": "two armchairs side by side in a pub, one modern and bright, one old and worn leather, a record player "
                  "and a phone on the table between them",
    "local": "a view through a rain speckled pub window onto a harbour town street at dusk, boats and warm streetlights",
}


def main():
    seeds = int(sys.argv[sys.argv.index("--seeds") + 1]) if "--seeds" in sys.argv else 2
    comfy = Comfy()
    if not comfy.up():
        raise SystemExit("the art server on port 8188 is not answering")
    os.makedirs(OUT, exist_ok=True)
    jobs = {}
    for name, scene in CARDS.items():
        for s in range(seeds):
            prompt = f"{scene}. {STYLE}"
            graph = graph_concept_zimage(prompt, 4100 + s, f"rp_{name}_{s}", width=1344, height=768, lora=None)
            jobs[comfy.submit(graph)] = f"{name}_{s}"
    started = time.time()
    done = comfy.wait(list(jobs), timeout=1800, poll=3)
    saved = {}
    for pid, hist in done.items():
        paths = comfy.download(hist, OUT)
        if paths:
            final = os.path.join(OUT, jobs[pid] + ".png")
            os.replace(paths[0], final)
            saved[jobs[pid]] = final
    print(f"{len(saved)} of {len(jobs)} images in {time.time() - started:.0f} s")
    # The contact sheet: one row per card, the seeds side by side, each 448 x 256 with its name.
    w, h = 448, 256
    sheet = Image.new("RGB", (w * seeds, (h + 24) * len(CARDS)), "white")
    draw = ImageDraw.Draw(sheet)
    for row, name in enumerate(CARDS):
        for s in range(seeds):
            path = saved.get(f"{name}_{s}")
            if path:
                sheet.paste(Image.open(path).resize((w, h)), (s * w, row * (h + 24) + 24))
            draw.text((s * w + 6, row * (h + 24) + 6), f"{name} {s + 1}", fill="black")
    sheet_path = os.path.join(OUT, "contact-sheet.png")
    sheet.save(sheet_path)
    print("sheet:", sheet_path)


if __name__ == "__main__":
    main()
