import { describe, expect, it, vi } from 'vitest'
import { createGame, favourites, join, lobby, start } from '../../src/room/game'
import { buildRoomRound, startWithRoomRound } from '../../src/room/taste'
import { QlooClient } from '../../src/qloo/client'
import { nameKey, verifyQuestion } from '../../src/quiz/verify'
import { ROOM_FAVOURITES, ROOM_ROUND_CALLS } from '../../src/limits'
import type { Question, Quiz, Round, RoundKind } from '../../src/quiz/types'

// Synthetic ids only, in the shape public_check allows.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const band = { min: 0.9, max: 0.97 }
const types: Record<string, string> = { film: 'movie', telly: 'tv_show', books: 'book', music: 'artist', generation: 'movie' }

function round(kind: RoundKind, first: number): Round {
  const questions: Question[] = Array.from({ length: 5 }, (_, q) => ({
    id: `${kind}-${q}`, template: `${kind}_first`, prompt: `${kind} ${q}?`, answer: 0, reveal: 'x',
    options: [0, 1, 2, 3].map((o) => ({
      label: `${kind} ${q}${o}`,
      record: { qlooId: id(first + q * 4 + o), name: `${kind} ${q}${o}`, type: types[kind], popularity: 0.93, field: 'release_year', value: 1990 + o * 5 },
    })),
  }))
  return { kind, level: 'medium', title: kind, banter: '', meter: { band, mean: 0.93, min: 0.93, max: 0.93, n: 20 }, questions }
}

function quiz(kinds: RoundKind[] = ['film', 'telly', 'books', 'music']): Quiz {
  return {
    id: 'quiz-taste', createdAt: 1, mode: 'cache',
    setup: { town: 'Glasgow, Scotland', crowd: ['30_to_34'], difficulty: 'mixed', rounds: kinds },
    rounds: kinds.map((kind, i) => round(kind, 100 * (i + 1))), qlooCalls: 0, neurons: 0,
  }
}

const SEEDS: Record<string, number> = { jaws: 1, abba: 2, dune: 3 }

/** A fake Qloo: search finds the seeds; the room call returns 10 top picks near 0.85; scoring the planned round
 *  gives its 20 items 0.66 to 0.82, the spread measured live on 28 Oct (Glasgow, a medium film round). */
function fakeQloo(opts: { plannedTop?: number; step?: number; failInsights?: boolean; allowAll?: boolean } = {}) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const headers = { 'X-Month-RateLimit-Remaining': '40000' }
    if (url.pathname === '/search') {
      const n = SEEDS[(url.searchParams.get('query') ?? '').toLowerCase()]
      const results = n ? [{ entity_id: id(n), name: url.searchParams.get('query'), types: ['urn:entity:movie'] }] : []
      return Response.json({ results }, { headers })
    }
    if (opts.failInsights) return new Response('{}', { status: 500 })
    const scored = url.searchParams.get('filter.results.entities')
    if (scored) {
      const ids = scored.split(',')
      const top = opts.plannedTop ?? 0.82
      const entities = ids.map((entity_id, i) => ({ entity_id, name: `scored ${i}`, popularity: 0.93, query: { affinity: top - i * (opts.step ?? 0.008) } }))
      return Response.json({ results: { entities } }, { headers })
    }
    const entities = Array.from({ length: 10 }, (_, i) => ({
      entity_id: id(900 + i), name: `Room pick ${i}`, popularity: 0.94, query: { affinity: 0.848 - i * 0.001 },
    }))
    return Response.json({ results: { entities } }, { headers })
  })
  const store = new Map<string, string>()
  const cache = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) }
  let allowed = 0
  const client = new QlooClient('fake-secret', fetcher as unknown as typeof fetch, cache, async () => opts.allowAll || ++allowed <= ROOM_ROUND_CALLS, { wait: async () => undefined })
  return { client, fetcher }
}

const favs = [{ nick: 'Ann', text: 'Jaws' }, { nick: 'Bo', text: 'ABBA' }, { nick: 'Cy', text: 'Dune' }]

describe('the room round: favourites at join', () => {
  it('keeps one favourite per player and says in the lobby who gave one', () => {
    let state = createGame(quiz(), 'BCDF', 10)
    state = join(state, 'player_1', 'Ann', 11, '  Jaws  ').state
    state = join(state, 'player_2', 'Bo', 12).state
    expect(state.players.player_1?.fav).toBe('Jaws')
    expect(state.players.player_2?.fav).toBeUndefined()
    expect(lobby(state).msg.players).toEqual([{ nick: 'Ann', fav: true }, { nick: 'Bo', fav: false }])
  })

  it('drops a favourite that is too long, has odd marks or a rude word, and still lets the player in', () => {
    const state = createGame(quiz(), 'BCDF', 10)
    for (const bad of ['x'.repeat(41), '<script>', 'Porn Star']) {
      const joined = join(state, 'player_1', 'Ann', 11, bad).state
      expect(joined.players.player_1?.nick).toBe('Ann')
      expect(joined.players.player_1?.fav).toBeUndefined()
    }
  })

  it('takes the first favourites in join order, one per title, at most the cap', () => {
    let state = createGame(quiz(), 'BCDF', 10)
    const names = ['Jaws', 'jaws', 'ABBA', 'Dune', 'Alien', 'Heat', 'Up', 'Big']
    names.forEach((fav, i) => { state = join(state, `player_${i}`, `P${i}`, 11 + i, fav).state })
    const picked = favourites(state)
    expect(picked.map((f) => f.text)).toEqual(['Jaws', 'ABBA', 'Dune', 'Alien', 'Heat'].slice(0, ROOM_FAVOURITES))
    expect(picked[0]).toEqual({ nick: 'P0', text: 'Jaws' })
  })
})

describe('the room round: built from the favourites', () => {
  it('replaces the last planned round with five fair questions, names on every reveal', async () => {
    const { client, fetcher } = fakeQloo()
    const planned = quiz()
    const result = await buildRoomRound(planned, favs, client)
    expect(result.built).toBe(true)
    const rounds = result.quiz.rounds
    expect(rounds.map((r) => r.kind)).toEqual(['film', 'telly', 'books', 'room'])
    const room = rounds[3]!
    expect(room.questions).toHaveLength(5)
    const used = new Set<string>()
    for (const q of room.questions) {
      expect(verifyQuestion(q, room.meter.band, used)).toBeNull()
      q.options.forEach((o) => used.add(o.record!.qlooId))
      expect(q.options[q.answer]!.record!.name).toMatch(/^Room pick/)
      expect(q.reveal).toContain("Ann's Jaws")
      expect(q.reveal).toContain("Cy's Dune")
      // A favourite is the signal, never an answer.
      expect(q.options.map((o) => o.record!.qlooId)).not.toContain(id(1))
    }
    // 3 searches and 2 insights calls, under the room's cap.
    expect(fetcher).toHaveBeenCalledTimes(5)
    const calls = fetcher.mock.calls.map(([u]) => new URL(String(u)))
    const signal = calls.filter((u) => u.pathname === '/v2/insights').map((u) => u.searchParams.get('signal.interests.entities'))
    expect(signal).toEqual([`${id(1)},${id(2)},${id(3)}`, `${id(1)},${id(2)},${id(3)}`])
    expect(calls[3]!.searchParams.get('filter.type')).toBe('urn:entity:artist')
  })

  it('does not use a top pick as an answer when its name already appears in the quiz', async () => {
    const planned = quiz()
    planned.rounds[0]!.questions[0]!.options[0]!.record!.name = 'Room pick 0'
    const result = await buildRoomRound(planned, favs, fakeQloo().client)
    expect(result.built).toBe(true)
    const earlierNames = new Set(planned.rounds.flatMap((round) => round.questions.flatMap((question) => [
      ...question.options.flatMap((option) => option.record ? [nameKey(option.record.name)] : []),
      ...(question.item ? [nameKey(question.item.name)] : []),
    ])))
    const roomAnswers = result.quiz.rounds.at(-1)!.questions.map((question) => nameKey(question.options[question.answer]!.record!.name))
    expect(roomAnswers).not.toContain(nameKey('room pick 0'))
    expect(earlierNames).toContain(nameKey('room pick 0'))
  })

  it('moves the room round to the end when the last planned round is not a media round', async () => {
    const { client } = fakeQloo()
    const result = await buildRoomRound(quiz(['film', 'telly', 'music', 'generation']), favs, client)
    expect(result.built).toBe(true)
    expect(result.quiz.rounds.map((r) => r.kind)).toEqual(['film', 'telly', 'generation', 'room'])
  })

  it('falls back to the planned round when Qloo fails, the margins are thin, or nobody gave a favourite', async () => {
    const planned = quiz()
    const failed = await buildRoomRound(planned, favs, fakeQloo({ failInsights: true }).client)
    expect(failed.built).toBe(false)
    expect(failed.quiz).toBe(planned)
    expect(failed.why).toMatch(/Qloo/)

    const thin = await buildRoomRound(planned, favs, fakeQloo({ plannedTop: 0.84, step: 0.001 }).client)
    expect(thin.built).toBe(false)
    expect(thin.quiz).toBe(planned)

    const none = fakeQloo()
    const empty = await buildRoomRound(planned, [], none.client)
    expect(empty.built).toBe(false)
    expect(none.fetcher).not.toHaveBeenCalled()
  })

  it('never makes more live calls than the room cap, however many favourites come in', async () => {
    // The client lets every call through here: the cap must come from the round itself.
    const { client, fetcher } = fakeQloo({ allowAll: true })
    const many = Array.from({ length: 12 }, (_, i) => ({ nick: `P${i}`, text: `Unknown ${i}` }))
    await buildRoomRound(quiz(), many, client)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(ROOM_ROUND_CALLS)
  })

  it('starts the room with the room round once, and starts it plain without a client', async () => {
    let state = createGame(quiz(), 'BCDF', 10)
    state = join(state, 'player_1', 'Ann', 11, 'Jaws').state
    const { client, fetcher } = fakeQloo()
    const ready = await startWithRoomRound(state, client)
    expect(ready.quiz.rounds.at(-1)?.kind).toBe('room')
    expect(ready.roomRound).toMatchObject({ built: true })
    const again = await startWithRoomRound(ready, client)
    expect(again).toBe(ready)
    expect(fetcher).toHaveBeenCalledTimes(3)
    const opened = start(ready, 20)
    expect(opened.messages[0]?.msg).toMatchObject({ of: 20 })

    const plain = await startWithRoomRound(state, null)
    expect(plain.quiz.rounds.at(-1)?.kind).toBe('music')
    expect(plain.roomRound).toMatchObject({ built: false })
  })
})

describe('the room round: the verifier', () => {
  it('refuses a room question whose marked answer is not the top score or whose margin is under 0.05', () => {
    const rec = (n: number, affinity: number) => ({ qlooId: id(n), name: `n${n}`, type: 'movie', popularity: 0.93, field: 'query.affinity', value: affinity })
    const question = (scores: number[], answer: number): Question => ({
      id: 'r', template: 'room_pick', prompt: 'p', reveal: 'r', answer,
      options: scores.map((s, i) => ({ label: `n${i}`, record: rec(i + 1, s) })),
    })
    expect(verifyQuestion(question([0.85, 0.79, 0.7, 0.72], 0), band, new Set())).toBeNull()
    expect(verifyQuestion(question([0.85, 0.79, 0.7, 0.72], 1), band, new Set())).toMatch(/marked answer/)
    expect(verifyQuestion(question([0.85, 0.81, 0.7, 0.72], 0), band, new Set())).toMatch(/margin/)
  })
})
