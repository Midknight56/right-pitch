# Right Pitch: look

## Palette: Chalkboard

Picked by the owner on 25 Oct 2026 from four options shown in the real screens. Every colour lives in
`public/theme.css`; the pages read only its tokens. The options not picked stay in `public/palettes/`.

| Token | Colour | Used for |
| --- | --- | --- |
| `--bg` | #f2f2ee | page background |
| `--surface` | #ffffff | cards |
| `--ink` | #1e2326 | text |
| `--accent` | #22313a | buttons, picked chips |
| `--accent-ink` | #ffd166 | text on the accent |
| `--tile-a` to `--tile-d` | #c23d4f, #00798c, #a26b00, #3d5a80 | the four answer tiles |
| `--good`, `--bad` | #2f6b43, #9b3328 | right and wrong |
| `--screen-bg` | #1c2a30 | the host screen, a chalkboard |
| `--screen-ink` | #fbfaf7 | chalk text on it |

Fixed colours outside the theme, on purpose: the white behind the QR code (scanners need it), see through white and
black layers on the host screen, and the print sheet.

## Round backdrops

One card per round kind behind the host screen, in `public/art/`, 1280 x 731 WebP.

| Card | Pick |
| --- | --- |
| lobby | seed 1 |
| film | seed 0 |
| telly | seed 1 |
| books | seed 1, the owner's pick (taller book stacks, lamp on the right) |
| faces | seed 1 |
| music | seed 1 |
| generation | seed 0 |
| local | seed 1 |
