# Right Pitch: spec (working name)

A pub quiz host picks the town and the crowd. Right Pitch builds four rounds from Qloo records: every answer is a field
of a real Qloo record, and every round is pitched by Qloo's popularity percentile for that crowd. Then the host runs it
live: the host screen shows a QR code, phones join with a nickname, and the scoreboard moves.

## Facts measured on 25 Oct 2026 (the Day 1 test, 47 Qloo calls)

1. Insights with no taste signal, or with only `signal.demographics.age`, return results in popularity order. The app
   sorts by `query.affinity` itself whenever it needs a crowd's ranking.
2. `signal.location.query=<town>` ranks by affinity AND spreads popularity inside a band. Every round query carries the
   town as a signal, so the round is pitched to that town's crowd and the difficulty meter reads a real spread.
3. `urn:entity:video_game` is refused by insights (HTTP 400). No game round.
4. Fields present: movie `properties.release_year` 100%, `external.imdb[0].user_rating` 100%; TV `release_year` 100%;
   book `publication_year` 99% (no author field); person `date_of_birth` 93%; artist `start_year` 88%; place
   `business_rating` 100% and `neighborhood` 100%. Popularity on 2,068 of 2,068 results.
5. The age lens: one fixed set scored under `24_and_younger` and under `55_and_older` moves 83 of 120 items by 0.15 or
   more in rank once sorted by affinity.
6. Rate headers on the shared key: 10 calls a second, 50,000 calls a month for every app on the key.

## Pages

| Path | What |
| --- | --- |
| `/` | the builder: town, crowd, difficulty, four round kinds, optional local seeds; Build; the build log; the rounds with a difficulty meter each; tap a tick to see the Qloo record; "Open the room" |
| `/h/<CODE>` | the host screen: QR code and join link, lobby, question, timer, answer counts, reveal, scoreboard |
| `/j/<CODE>` | the phone: nickname, wait, four big answer buttons, result, own score |
| `/q/<id>/print` | the printable sheet (cut last if time runs out) |

## API

| Route | What |
| --- | --- |
| `GET /api/presets` | the preset setups (the demo's "Tuesday, a Halifax pub, mostly 30 to 50") |
| `POST /api/build` | one build, streamed as NDJSON events (below). Body: `{ setup }` |
| `GET /api/quiz/<id>` | a built quiz (with answers: the host's copy) |
| `POST /api/rooms` | `{ quiz }` makes a room; answers `{ code, hostToken }` |
| `GET /api/rooms/<CODE>/socket` | WebSocket into the room's Durable Object. Query: `role=host&token=...` or `role=player&nick=...&pid=...` |
| `POST /api/report` | `{ quiz, question, why }` a wrong-answer report, written to D1 |
| `GET /health` | ok |

## The setup

```ts
interface Setup {
  town: string                 // "Halifax"; sent as signal.location.query and, for the local round, filter.location.query
  crowd: Age[]                 // Qloo age buckets, at least one: 24_and_younger 25_to_29 30_to_34 35_to_44 45_to_54 55_and_older
  difficulty: 'easy' | 'mixed' | 'hard'
  rounds: RoundKind[]          // exactly 4, no repeats
  seeds?: string[]             // up to 3 names the host types (home team, local band); resolved with /search
  night?: string               // "Tuesday": banter only
}
```

## Round kinds and their question templates

Every question is multiple choice. Each option that is an entity carries its Qloo id and popularity. The answer is
computed from a field of the returned records, never written by the model.

| Round kind | Qloo type | Template(s) | Field | Verified when |
| --- | --- | --- | --- | --- |
| `film` | movie | "Which of these came out first?" / "Which has the highest IMDb user rating?" | `release_year`, `external.imdb[0].user_rating` | 4 options, unique answer, earliest year 3+ years before the next; top rating 0.3+ above the next |
| `telly` | tv_show | "Which of these shows started first?" | `release_year` | as above |
| `books` | book | "Which of these was published first?" | `publication_year` | as above |
| `faces` | person | "Who was born first?" | `date_of_birth` | earliest birth 3+ years before the next |
| `music` | artist | "Which act started out first?" | `start_year` | as above |
| `generation` | movie, tv_show, artist | "Who leans to X more: 24 and younger, or 55 and older?" | affinity under each lens (2 calls, `filter.results.entities`) | affinity gap 0.15 or more; the reveal shows two bars |
| `local` | place | "X is in which part of <town>?" / "Which of these has the best rating?" | `neighborhood`, `business_rating` | 4 distinct neighbourhoods; top rating 0.2+ above the next |

Each round: 5 questions, 4 options (generation: 2). Every entity in a round sits inside the round's popularity band.

## Difficulty bands (popularity percentile)

| Level | Band |
| --- | --- |
| easy | 0.97 to 1.0 |
| medium | 0.90 to 0.97 |
| hard | 0.75 to 0.90 |
| deep | 0.50 to 0.75 |

`mixed` = easy, medium, medium, hard. `hard` = medium, hard, hard, deep. The meter shows the band and the measured
mean, min and max popularity of the round's entities.

The crowd's era: for film, telly and music the year filter is the decades when the crowd's middle age bucket was 10 to
25 years old (crowd 30 to 50 in 2026: born 1976 to 1996, so 1986 to 2021), widened if a round fails.

## The build loop (the agent)

1. PLAN. The model (Workers AI, tool `plan_rounds`) or, at 0 neurons, the template planner, turns the setup into four
   round plans: kind, band, era, seeds. The model sees the setup and the template list only.
2. QUERY. Each plan is one Qloo insights call (take 50): `filter.type`, `filter.popularity.min/max`,
   `signal.location.query`, `signal.demographics.age` (the crowd list), the era filter, `filter.exclude.entities`
   (the host's last quizzes, from D1). Generation adds two `filter.results.entities` calls; local uses
   `filter.location.query`. Seeds go through `/search` once each.
3. FILL. Templates draw options from the results.
4. VERIFY. Each question: field present on every option, answer unique, margins above, popularity inside the band,
   no entity used twice in the quiz.
5. REPLAN. A round with fewer than 5 verified questions is planned again (wider band, wider era, or a sister template),
   at most twice. The build stops at 16 Qloo calls.
6. NAME. The model writes four round titles and one line of banter each (tool `name_rounds`); the template names are
   the fallback. The model never writes a question or an answer.

Modes: `live` (Qloo and the model), `template` (Qloo, no model: budget spent), `cache` (the same setup built before,
from D1, 0 calls), `replay` (the six presets recorded live once, in D1), `off` (no key: presets only).

## Build events (NDJSON, one per line)

```
{ t: 'start', mode, quiz }                        the quiz id
{ t: 'plan', rounds: [{ kind, band, era }] }
{ t: 'call', round, path, params, results, ms, cached }   one Qloo call, shown in the log
{ t: 'question', round, index, ok, why? }          a green tick, or the reason it was dropped
{ t: 'replan', round, why }
{ t: 'round', round }                             a finished Round
{ t: 'usage', qloo, neurons }
{ t: 'done', quiz }                               the whole Quiz
{ t: 'error', text }
```

## The room (one Durable Object per room code)

- Code: 4 letters from `BCDFGHJKLMNPQRSTVWXZ` (no vowels, so no words). Host token: HMAC of the code with the secret.
- Phases: `lobby` → `question` (20 s, an alarm locks it) → `reveal` → next question … → `end`.
- Host sends: `start`, `next`, `end`, `kick {pid}`. Player sends: `answer {q, choice}` (first answer counts).
- Room sends: `lobby {players}`, `question {n, of, round, prompt, options, endsAt}`, `locked {n, answered}`,
  `reveal {n, answer, counts, record, extra}`, `scores {top}`, `you {score, rank, last}`, `end {top}`, `error {text}`.
- Score: 1,000 for a right answer plus up to 500 for speed.
- The room's round (since 28 Oct): a player may send `fav` (up to 40 letters, digits and title marks, no rude word) with
  the socket open. At Start, `src/room/taste.ts` searches up to 5 favourites, asks insights for the room's top picks in
  the last media round's type and band, and scores that round's 20 records against the same taste; questions are
  `room_pick` (4 options, answer beats every other by 0.05 affinity). Under 3 fair questions or any failure: the planned
  round plays. At most 7 live calls a room, from the 'qloo-total' daily count. `RoomState.roomRound` records the result.
- Stores: the quiz (with answers), and per player only a nickname, an optional favourite, a random player id and a score. Everything is
  deleted 24 hours after the room is made (an alarm), and a room past 24 hours refuses every socket.
- WebSocket Hibernation API (`ctx.acceptWebSocket`), so a quiet room costs no duration.

## Caps (`src/limits.ts`, the arithmetic beside each constant)

See the file. Each cap has a test shown failing with the check off.

## Not stored, not shown

No accounts. No names beyond a nickname of 1 to 16 letters, digits and spaces. A visitor is a salted hash of the
address. No Qloo response data in the repo: tests use synthetic fixtures; recorded presets live in private D1.
