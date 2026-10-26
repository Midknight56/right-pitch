import { describe, expect, it } from 'vitest'
import { answer, createGame, end, join, kick, lock, next, snapshot, start, type RoomState } from '../../src/room/game'
import type { Quiz, Question } from '../../src/quiz/types'

function makeQuiz(count = 20): Quiz {
  const questions: Question[] = Array.from({ length: count }, (_, n) => ({
    id: `q${n}`, template: 'template', prompt: `Question ${n}?`, answer: 1, reveal: `Option 1 is right for ${n}.`,
    options: [0, 1, 2, 3].map((x) => ({ label: `Option ${n}-${x}`, record: { qlooId: `id-${n}-${x}`, name: `Name ${x}`, type: 'movie', popularity: 0.9, field: 'year', value: 2000 } })),
  }))
  return { id: 'quiz123', createdAt: 1, mode: 'template', setup: { town: 'Halifax', crowd: ['30_to_34'], difficulty: 'easy', rounds: ['film', 'telly', 'books', 'music'] }, rounds: Array.from({ length: Math.ceil(count / 5) }, (_, i) => ({ kind: 'film', level: 'easy', title: `Round ${i + 1}`, banter: '', meter: { band: { min: .97, max: 1 }, mean: .99, min: .98, max: 1, n: 4 }, questions: questions.slice(i * 5, i * 5 + 5) })), qlooCalls: 0, neurons: 0 }
}
const now = 100_000
function game(): RoomState { return createGame(makeQuiz(), 'BCDF', now) }

describe('room game state machine', () => {
  it('runs 20 questions through joins, timed and all answered locks, reveals, scores, and end', () => {
    let state = game()
    for (const [i, nick] of ['Alex', 'Blair', 'Casey'].entries()) state = join(state, `player_${i}`, nick, now + 1).state
    const opened = start(state, now + 2); state = opened.state
    expect(state.phase).toBe('question')
    expect(opened.messages[0]?.msg).not.toHaveProperty('answer')
    expect(opened.messages[0]?.msg).not.toHaveProperty('qlooId')

    for (let n = 0; n < 20; n++) {
      const qStart = n === 0 ? now + 2 : now + 3 + n * 100
      if (state.phase === 'reveal') state = next(state, qStart).state
      expect(state.n).toBe(n)
      const first = answer(state, 'player_0', n, 1, qStart + 100)
      expect(first.state.players.player_0?.last?.n).toBe(n)
      expect(answer(first.state, 'player_0', n, 0, qStart + 200).state).toBe(first.state)
      const submitted = ['player_0', 'player_1'].map((pid, i) => ({ pid, choice: 1, at: qStart + 1000 + i * 100 }))
      const revealed = lock(state, submitted, qStart + 20_000)
      state = revealed.state
      expect(state.phase).toBe('reveal')
      expect(revealed.messages.some((m) => m.msg.type === 'locked' && m.msg.answered === 2)).toBe(true)
      expect(state.players.player_0?.score).toBeGreaterThan(1000)
      expect(state.players.player_0?.score).toBeLessThanOrEqual(1500 * (n + 1))
      expect(revealed.messages.some((m) => m.msg.type === 'reveal' && m.msg.answer === 1 && Array.isArray(m.msg.record))).toBe(true)
      if (n < 19) state = next(state, qStart + 21_000).state
    }
    state = next(state, state.endsAt + 1).state
    expect(state.phase).toBe('end')
    expect(end(state).state).toBe(state)
  })

  it('locks by timeout even with no answers and sends counts', () => {
    const state = start(game(), now + 1).state
    expect(answer(state, 'nobody_1', state.n, 0, state.endsAt).state).toBe(state)
    const res = lock(state, [], state.endsAt)
    expect(res.state.phase).toBe('reveal')
    expect(res.messages.find((m) => m.msg.type === 'locked')?.msg.answered).toBe(0)
  })

  it('refuses player 41, invalid names, duplicates nicknames, and expired joins', () => {
    let state = game()
    for (let i = 0; i < 40; i++) state = join(state, `pid_${i}`, `Nick ${i}`, now + 1).state
    expect(join(state, 'pid_40', 'Nick 40', now + 1).state).toBe(state)
    expect(join(game(), 'player_1', 'x'.repeat(17), now + 1).messages[0]?.msg.type).toBe('error')
    expect(join(game(), 'player_1', '☃', now + 1).messages[0]?.msg.type).toBe('error')
    const first = join(game(), 'player_1', 'Alex', now + 1)
    expect(join(first.state, 'player_2', 'Alex', now + 2).state.players.player_2?.nick).toBe('Alex 2')
    expect(join(game(), 'player_1', 'Alex', now + 24 * 60 * 60 * 1000).state.players).toEqual({})
  })

  it('preserves reconnect score and refuses a kicked player', () => {
    let state = join(game(), 'player_1', 'Alex', now + 1).state
    state = { ...state, players: { ...state.players, player_1: { ...state.players.player_1!, score: 3456 } } }
    expect(join(state, 'player_1', 'Changed Nick', now + 2).state.players.player_1?.score).toBe(3456)
    state = kick(state, 'player_1').state
    expect(join(state, 'player_1', 'Alex', now + 3).state.players).not.toHaveProperty('player_1')
  })

  it('never puts answers or Qloo records into question messages', () => {
    const msg = JSON.stringify(start(game(), now + 1).messages)
    expect(msg).not.toMatch(/answer|qlooId/i)
  })

  it('snapshots the current question, answered lock, reveal scores, own score, and end', () => {
    let state = join(game(), 'player_1', 'Alex', now + 1).state
    state = start(state, now + 2).state
    const question = snapshot(state, 'host', now + 10_000)
    expect(question[0]?.msg).toMatchObject({ type: 'question', n: 0, endsAt: state.endsAt })

    state = answer(state, 'player_1', 0, 1, now + 3).state
    expect(snapshot(state, 'player_1', now + 4).map((item) => item.msg.type)).toEqual(['question', 'locked'])

    state = lock(state, [{ pid: 'player_1', choice: 1, at: now + 3 }], now + 20_000).state
    // A screen that reloads during a reveal needs the question too: without it the live host showed no prompt, no
    // tiles and ", 1 of" (26 Oct).
    const back = snapshot(state, 'host', now + 21_000)
    expect(back.map((item) => item.msg.type)).toEqual(['question', 'reveal', 'scores'])
    expect(back[0].msg).toMatchObject({ n: 0, of: 20 })
    expect((back[0].msg as { prompt?: string }).prompt).toBeTruthy()
    expect(snapshot(state, 'player_1', now + 21_000).map((item) => item.msg.type)).toEqual(['question', 'reveal', 'scores', 'you'])

    state = end(state).state
    expect(snapshot(state, 'player_1', now + 22_000).map((item) => item.msg.type)).toEqual(['end'])
  })
})
