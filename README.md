# Right Pitch

A pub quiz pitched at the room you are in.

The host picks the town and who is in the room. Right Pitch builds four rounds from Qloo's taste data, pitched to that
crowd: easy enough that nobody sits out, hard enough that the room argues. Then the host runs it live. The big screen
shows a QR code, phones join with a nickname, and the scoreboard moves.

Try it: https://right-pitch.midknight-labs.workers.dev

## How a quiz is built

1. **Plan.** A small model on Cloudflare Workers AI turns the setup into four round plans: the kind of round, how hard,
   and which years suit the crowd. It never writes a question or an answer.
2. **Ask Qloo.** Each round is one Qloo insights call, with the town and the crowd's ages as signals and a popularity
   band for the difficulty. The generation round scores the same items under a young lens and an old lens.
3. **Fill.** Fixed templates turn the records into questions: which came out first, who was born first, which has the
   best rating, which part of town is it in, who leans to it more.
4. **Check.** Every question is checked against the records before it is kept. The marked answer must be the one the
   field picks, with a clear margin (3 years, or 0.2 to 0.3 on a rating). Every option must sit inside the round's band, and
   no name appears twice.
5. **Plan again.** A round with fewer than 5 good questions is planned again, wider, at most twice. A build stops at
   16 Qloo calls.
6. **Name.** The model names each round from what it really holds. Titles with digits or dashes fall back to the house
   titles.

Every answer is a field of a real Qloo record, and the host can tap any question to see it. The difficulty meter on
each round shows the band and where the round's names really sit.

## Running a night

| Screen | Address | What it does |
| --- | --- | --- |
| Builder | `/` | town, crowd, difficulty, four round kinds, up to 3 local names; the build log; the rounds |
| Host | `/h/CODE` | QR code, lobby, question and timer, answer counts, reveal, scoreboard, the podium |
| Phone | `/j/CODE` | nickname, four big answer buttons, right or wrong, your score |
| Print | `/q/ID/print` | a paper copy with an answer sheet |

Each question runs 20 seconds. A right answer scores 1,000 plus up to 500 for speed. A phone or the host screen that
drops comes back where it was.

## Free to run

The app runs on the Cloudflare Workers free plan and a shared Qloo hackathon key. Every cap is in `src/limits.ts`, with
the arithmetic beside it, and each has a test that fails with its check taken out.

| Cap | Value |
| --- | --- |
| Qloo calls a day, the whole app | 500 |
| Qloo calls in one build | 16, spaced to stay under 10 a second |
| Fresh builds pause when the shared key's month has fewer calls left than | 3,000 |
| Fresh builds a visitor a day | 2 |
| Model use a day | 450 neurons (a measured build uses about 7) |
| Rooms a day, and per visitor | 60, and 3 |
| Players in a room | 40 |

The same setup built twice is served from the cache: 0 Qloo calls and 0 model use. When the model budget is spent, a
build still runs from Qloo with the house titles. Playing a quiz costs no Qloo calls at all.

## Privacy

No accounts. A player gives a nickname of 1 to 16 letters, digits and spaces. A room keeps only the quiz, the
nicknames, a random player id and the scores, and it deletes itself 24 hours after it is made. A visitor is counted
by a salted hash of their address, for the daily caps only.

No Qloo response data is kept in this repository. The tests use hand written fixtures. Built quizzes live in the
app's own database.

## Run it yourself

You need Node 22 or later, a Cloudflare account and a Qloo API key.

```
npm install
npx wrangler d1 create right-pitch
```

Put your account id and the new database id in `wrangler.jsonc`. Remove the `LEDGER` database there: without it the
app counts its model use in its own database. Then make `.dev.vars`:

```
QLOO_API_KEY=your key
SESSION_SECRET=any long random string
```

```
npx wrangler d1 migrations apply right-pitch --local
npx wrangler dev
```

Open http://127.0.0.1:8787.

## Tests

```
npm run gate
```

Type checks and the unit tests. Then the browser tests:

```
npx playwright install chromium
node tools/e2e.mjs http://127.0.0.1:8787
node tools/phones.mjs
```

The first line fetches the test browser, once.

`tools/e2e.mjs` plays a whole night against the running app with a host and two phones, plus the bad paths: 15 steps.
`tools/phones.mjs` needs no running app. It serves the pages with scripted data and measures twelve screens at fourteen
phone widths, and the four host screens at three TV sizes, for spacing, size and overflow: 180 pictures.

## Licence

MIT. See `LICENSE`.
