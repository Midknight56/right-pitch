"""The palette options side by side, one column each: host question, host reveal, phone question, phone result.
python tools/palette_compare.py bottle chalk harbour oxblood greys"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'out' / 'shots'
NAMES = {'bottle': '1  Bottle green and brass', 'chalk': '2  Chalkboard', 'harbour': '3  Harbour', 'oxblood': '4  Oxblood and gold', 'greys': 'Now: neutral greys'}
palettes = sys.argv[1:]
COL = 560
font = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 26)
cols = []
for p in palettes:
    d = OUT / p
    host = [Image.open(d / f'{n}.png').convert('RGB').resize((COL, 315)) for n in ('host-question', 'host-reveal')]
    phones = [Image.open(d / f'{n}.png').convert('RGB').crop((0, 0, 390, 640)) for n in ('phone-question', 'phone-reveal')]
    phones = [im.resize((272, 446)) for im in phones]
    col = Image.new('RGB', (COL, 50 + 315 * 2 + 12 * 2 + 446), '#ffffff')
    ImageDraw.Draw(col).text((4, 8), NAMES.get(p, p), fill='#111111', font=font)
    col.paste(host[0], (0, 50)); col.paste(host[1], (0, 50 + 315 + 12))
    col.paste(phones[0], (0, 50 + 630 + 24)); col.paste(phones[1], (COL - 272, 50 + 630 + 24))
    cols.append(col)
sheet = Image.new('RGB', (len(cols) * (COL + 24) + 24, cols[0].height + 48), '#ffffff')
for i, c in enumerate(cols):
    sheet.paste(c, (24 + i * (COL + 24), 24))
sheet.save(OUT / 'palette-compare.png')
print(OUT / 'palette-compare.png', sheet.size)
