import { describe, expect, it } from 'vitest'
import { allowSocketOpen, countSocketMessage, dispatchRoomMessage, inspectRoomMessage, parseRoomMessage } from '../../src/room/adapter'
import { HOST_MESSAGES_PER_SOCKET, PLAYER_MESSAGES_PER_SOCKET, SOCKET_OPENS_PER_ROOM } from '../../src/limits'
import { createGame, join } from '../../src/room/game'
import type { Quiz } from '../../src/quiz/types'

describe('room adapter logic', () => {
  it('allows the final socket slot and blocks the next open', () => {
    expect(allowSocketOpen(SOCKET_OPENS_PER_ROOM - 1)).toBe(true)
    expect(allowSocketOpen(SOCKET_OPENS_PER_ROOM)).toBe(false)
  })
  it('counts player and host messages and blocks above each cap', () => {
    expect(countSocketMessage({ role: 'player', sent: PLAYER_MESSAGES_PER_SOCKET - 1 })).toEqual({ allowed: true, sent: PLAYER_MESSAGES_PER_SOCKET })
    expect(countSocketMessage({ role: 'player', sent: PLAYER_MESSAGES_PER_SOCKET }).allowed).toBe(false)
    expect(countSocketMessage({ role: 'host', sent: HOST_MESSAGES_PER_SOCKET }).allowed).toBe(false)
  })
  it('counts junk frames and closes after 61 player messages', () => {
    let sent = 0
    for (let i = 0; i < PLAYER_MESSAGES_PER_SOCKET; i++) {
      const inspected = inspectRoomMessage({ role: 'player', sent }, 'not json')
      expect(inspected.allowed).toBe(true)
      expect(inspected.input).toBeNull()
      sent = inspected.sent
    }
    const last = inspectRoomMessage({ role: 'player', sent }, 'not json')
    expect(last.allowed).toBe(false)
  })
  it('accepts only small JSON objects', () => {
    expect(parseRoomMessage('{"type":"start"}')).toEqual({ type: 'start' })
    expect(parseRoomMessage('x'.repeat(513))).toBeNull()
    expect(parseRoomMessage('[]')).toBeNull()
    expect(parseRoomMessage('bad')).toBeNull()
  })
  it('dispatches host controls and returns a valid player answer for its socket attachment', () => {
    const quiz: Quiz = { id: 'quiz123', createdAt: 1, mode: 'template', setup: { town: 'Halifax', crowd: ['30_to_34'], difficulty: 'easy', rounds: [] }, rounds: [{ kind: 'film', level: 'easy', title: 'Film', banter: '', meter: { band: { min: 0, max: 1 }, mean: .5, min: 0, max: 1, n: 2 }, questions: [{ id: 'q1', template: 't', prompt: 'Q?', options: [{ label: 'A' }, { label: 'B' }], answer: 1, reveal: 'B' }] }], qlooCalls: 0, neurons: 0 }
    const joined = join(createGame(quiz, 'BCDF', 100), 'player_01', 'Alex', 101).state
    const opened = dispatchRoomMessage(joined, 'host', 'host', { type: 'start' }, 102)
    expect(opened.state.phase).toBe('question')
    const submitted = dispatchRoomMessage(opened.state, 'player', 'player_01', { type: 'answer', q: 0, choice: 1 }, 103)
    expect(submitted.answer).toEqual({ n: 0, choice: 1, at: 103 })
    expect(dispatchRoomMessage(opened.state, 'player', 'player_01', { type: 'answer', q: 0, choice: 7 }, 104).answer).toBeUndefined()
  })
})
