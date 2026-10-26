import { describe, expect, it } from 'vitest'
import { createGame, join } from '../../src/room/game'
import { allowSocketOpen, countSocketMessage } from '../../src/room/adapter'
import { handleRooms } from '../../src/room/routes'
import {
  PLAYER_MESSAGES_PER_SOCKET,
  PLAYERS_PER_ROOM,
  ROOMS_PER_DAY,
  ROOMS_PER_VISITOR_PER_DAY,
  ROOM_HOURS,
  SOCKET_OPENS_PER_ROOM,
} from '../../src/limits'

const quiz = { id: 'q123456', createdAt: 1, mode: 'template' as const, setup: { town: 'Halifax', crowd: ['30_to_34' as const], difficulty: 'easy' as const, rounds: [] }, rounds: [], qlooCalls: 0, neurons: 0 }
function fresh() {
  return createGame(quiz, 'BCDF', 10)
}

function routeFixture() {
  const counts = new Map<string, number>()
  const env = {
    SESSION_SECRET: 'test-secret',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ quiz: JSON.stringify(quiz) }) }) }) },
    COUNTERS: {
      idFromName: (name: string) => name,
      get: (key: string) => ({
        take: async (_day: string, limit: number) => {
          const used = counts.get(key) ?? 0
          if (used >= limit) return false
          counts.set(key, used + 1)
          return true
        },
      }),
    },
    ROOMS: {
      idFromName: (code: string) => code,
      get: () => ({ init: async () => {}, fetch: async () => new Response('{}') }),
    },
  } as never
  const make = (ip = '1.2.3.4') => new Request('https://example.test/api/rooms', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: 'https://example.test',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ quiz: 'q' }),
  })
  return { env, make }
}

describe('room capacity checks (written before their checks)', () => {
  it('refuses player 41', () => {
    let state = fresh()
    for (let i = 0; i < PLAYERS_PER_ROOM; i++) state = join(state, `pid_${i}`, `Nick ${i}`, 11).state
    expect(join(state, 'pid_40', 'Nick 40', 12).state.players).not.toHaveProperty('pid_40')
  })

  it('refuses socket open 121', () => {
    expect(allowSocketOpen(SOCKET_OPENS_PER_ROOM)).toBe(false)
  })

  it('refuses player message 61', () => {
    expect(countSocketMessage({ role: 'player', sent: PLAYER_MESSAGES_PER_SOCKET }).allowed).toBe(false)
  })

  it('refuses the fourth room for one visitor in a day', async () => {
    const { env, make } = routeFixture()
    for (let i = 0; i < ROOMS_PER_VISITOR_PER_DAY; i++) {
      expect((await handleRooms(make(), env)).status).toBe(201)
    }
    expect((await handleRooms(make(), env)).status).toBe(429)
  })

  it('refuses room 61 in one day', async () => {
    const { env, make } = routeFixture()
    for (let i = 0; i < ROOMS_PER_DAY; i++) {
      expect((await handleRooms(make(`10.0.0.${i + 1}`), env)).status).toBe(201)
    }
    expect((await handleRooms(make('10.1.1.1'), env)).status).toBe(429)
  })

  it('refuses a join at the 24 hour expiry', () => {
    const state = fresh()
    const expired = state.createdAt + ROOM_HOURS * 60 * 60 * 1000
    expect(join(state, 'pid_1', 'Alex', expired).state.players).not.toHaveProperty('pid_1')
  })
})
