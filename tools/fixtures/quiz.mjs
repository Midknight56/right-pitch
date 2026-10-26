// A made up quiz for the picture tools and the phone sweep. Synthetic: every id is 00000000-0000-4000-8000-...,
// every popularity number is invented, and nothing here came from a Qloo response.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let next = 1
const rec = (name, type, popularity, field, value) => ({ qlooId: id(next++), name, type: `urn:entity:${type}`, popularity, field, value })
const q = (qid, prompt, labels, answer, reveal, type, field, values, extra = {}) => ({
  id: qid, template: 'which_first', prompt, answer, reveal,
  options: labels.map((label, i) => ({ label, record: rec(label, type, 0.9 + i * 0.01, field, values[i]) })),
  ...extra,
})

export const QUIZ = {
  id: 'demo-fixture-1',
  createdAt: 0,
  mode: 'template',
  setup: { town: 'Halifax', crowd: ['30_to_34', '35_to_44', '45_to_54'], difficulty: 'mixed', rounds: ['film', 'music', 'generation', 'local'] },
  qlooCalls: 0,
  neurons: 0,
  rounds: [
    {
      kind: 'film', level: 'easy', title: 'Big screen classics', banter: 'Popcorn brains on.',
      meter: { band: { min: 0.97, max: 1 }, mean: 0.983, min: 0.971, max: 0.996, n: 20 },
      questions: [
        q('f1', 'Which of these came out first?', ['The Harbour Light', 'Two Kinds of Rain', 'Northbound', 'The Cheerleaders'], 2, 'Northbound came out in 1994.', 'movie', 'release_year', [1999, 2003, 1994, 2001]),
        q('f2', 'Which one has the best audience score?', ['Saltwater Sky', 'The Long Table', 'Echo Park Blues', 'Lantern'], 1, 'The Long Table scores 8.4.', 'movie', 'user_rating', [7.1, 8.4, 6.9, 7.7]),
      ],
    },
    {
      kind: 'music', level: 'medium', title: 'Pub jukebox', banter: 'Hum it if you have to.',
      meter: { band: { min: 0.9, max: 0.97 }, mean: 0.934, min: 0.905, max: 0.966, n: 20 },
      questions: [
        q('m1', 'Which act started out first?', ['The Tidewaters', 'Glass Animals of Lune', 'Marigold Static', 'Copper Sun'], 0, 'The Tidewaters started in 1988.', 'artist', 'start_year', [1988, 2009, 1997, 2004]),
      ],
    },
    {
      kind: 'generation', level: 'medium', title: 'The generation game', banter: 'Young or old?',
      meter: { band: { min: 0.9, max: 0.97 }, mean: 0.941, min: 0.91, max: 0.962, n: 20 },
      questions: [
        { ...q('g1', 'Who leans to Saltwater Sky more?', ['24 and younger', '55 and older'], 1, '55 and older lean to it far more.', 'movie', 'release_year', [1987, 1987]), lens: { young: 0.31, old: 0.78 } },
      ],
    },
    {
      kind: 'local', level: 'hard', title: 'Home turf', banter: 'Home advantage.',
      meter: { band: { min: 0.75, max: 0.9 }, mean: 0.82, min: 0.761, max: 0.889, n: 20 },
      questions: [
        q('l1', 'Which spot near the harbour rates highest?', ['The Anchor Room', 'Fog & Fiddle', 'Wharf Street Kitchen', 'Bluenose Bakery'], 3, 'Bluenose Bakery rates 4.8.', 'place', 'business_rating', [4.3, 4.5, 4.1, 4.8]),
      ],
    },
  ],
}

/** The build stream the builder page reads, as NDJSON lines. */
export function buildEvents(quiz = QUIZ) {
  const events = [{ t: 'start', mode: quiz.mode, quiz: quiz.id }, { t: 'plan', rounds: quiz.rounds.map((r) => ({ kind: r.kind, level: r.level, band: r.meter.band })), by: 'template' }]
  quiz.rounds.forEach((round, index) => {
    events.push({ t: 'call', round: index, path: '/v2/insights', params: { 'filter.type': 'urn:entity:movie', 'filter.popularity.min': String(round.meter.band.min), 'filter.popularity.max': String(round.meter.band.max), 'signal.location.query': 'Halifax' }, results: 20, ms: 280, cached: true })
    round.questions.forEach((_, i) => events.push({ t: 'question', round: index, index: i, ok: true }))
    events.push({ t: 'round', index, round })
  })
  events.push({ t: 'usage', qloo: 0, neurons: 0 }, { t: 'done', quiz })
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n'
}
