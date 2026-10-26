"""One contact sheet per palette from out/shots/<palette>/, and one sheet that sets the palettes side by side.
python tools/shot_sheet.py [palette ...]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'out' / 'shots'
ORDER = ['host-lobby', 'host-question', 'host-reveal', 'host-lens', 'phone-question', 'phone-reveal', 'builder']


def sheet(palette):
    """Host screens in a 2 by 2 grid, the phones and the top of the builder beside them."""
    d = OUT / palette
    shots = {n: Image.open(d / f'{n}.png').convert('RGB') for n in ORDER if (d / f'{n}.png').exists()}
    W, H = 1280, 720
    s = 0.5
    canvas = Image.new('RGB', (int(W * s * 2) + 16 * 3 + int(390 * s * 2) + 16 * 2 + 640, int(H * s * 2) + 16 * 3 + 40), '#ffffff')
    draw = ImageDraw.Draw(canvas)
    draw.text((16, 12), palette, fill='#000000')
    for i, n in enumerate(ORDER[:4]):
        if n in shots:
            canvas.paste(shots[n].resize((int(W * s), int(H * s))), (16 + (i % 2) * (int(W * s) + 16), 40 + (i // 2) * (int(H * s) + 16)))
    x = 16 * 3 + int(W * s * 2)
    for j, n in enumerate(ORDER[4:6]):
        if n in shots:
            im = shots[n]
            ph = int(H * s * 2) + 16
            canvas.paste(im.resize((int(im.width * ph / im.height), ph)), (x, 40))
            x += int(im.width * ph / im.height) + 16
    if 'builder' in shots:
        b = shots['builder']
        crop = b.crop((0, 0, b.width, min(b.height, int(b.width * (int(H * s * 2) + 16) / 640))))
        canvas.paste(crop.resize((640, int(crop.height * 640 / crop.width))), (x, 40))
    canvas = canvas.crop((0, 0, x + 640 + 16, canvas.height))
    canvas.save(d / 'sheet.png')
    return canvas


if __name__ == '__main__':
    names = sys.argv[1:] or sorted(p.name for p in OUT.iterdir() if p.is_dir())
    sheets = [sheet(n) for n in names]
    if len(sheets) > 1:
        w = max(s.width for s in sheets)
        all_ = Image.new('RGB', (w, sum(s.height for s in sheets)), '#ffffff')
        y = 0
        for s in sheets:
            all_.paste(s, (0, y))
            y += s.height
        all_.save(OUT / 'palettes.png')
        print(OUT / 'palettes.png')
    else:
        print(OUT / names[0] / 'sheet.png')
