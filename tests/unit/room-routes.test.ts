import { describe, expect, it } from 'vitest'
import { handleRooms } from '../../src/room/routes'
import { ROOMS_PER_DAY, ROOMS_PER_VISITOR_PER_DAY } from '../../src/limits'
import type { Quiz } from '../../src/quiz/types'

const quiz: Quiz = { id: 'quiz123', createdAt: 1, mode: 'template', setup: { town: 'Halifax', crowd: ['30_to_34'], difficulty: 'easy', rounds: [] }, rounds: [], qlooCalls: 0, neurons: 0 }
function fixture(opts: { quiz?: Quiz | null; visitorCap?: number; totalCap?: number } = {}) {
  const counts = new Map<string, number>(), infos = new Map<string, { exists: boolean; phase?: string; players?: number }>()
  const env = {
    SESSION_SECRET: 'test-secret',
    DB: { prepare: () => ({ bind: () => ({ first: async () => opts.quiz === null ? null : { quiz: JSON.stringify(opts.quiz ?? quiz) } }) }) },
    COUNTERS: { idFromName: (id: string) => id, get: (id: string) => ({ take: async (_day: string, limit: number) => { const n = counts.get(id) ?? 0; if (n >= limit) return false; counts.set(id, n + 1); return true } }) },
    ROOMS: { idFromName: (id: string) => id, get: (id: string) => ({ init: async () => { if (infos.get(id)?.exists) throw new Error('Room already initialized'); infos.set(id, { exists: true, phase: 'lobby', players: 0 }) }, info: async () => infos.get(id) ?? { exists: false }, fetch: async (req: Request) => new Response(req.headers.get('x-role'), { status: 202 }) }) },
  } as never
  void opts.visitorCap; void opts.totalCap
  const post = (ip = '1.2.3.4', quizId = 'quiz123') => new Request('https://app.test/api/rooms', { method: 'POST', headers: { Origin: 'https://app.test', 'CF-Connecting-IP': ip, 'content-type': 'application/json' }, body: JSON.stringify({ quiz: quizId }) })
  return { env, post, infos }
}

describe('room routes', () => {
  it('rejects malformed codes, non-upgrade requests, and unknown rooms', async () => {
    const f = fixture()
    expect((await handleRooms(new Request('https://app.test/api/rooms/ABCD'), f.env)).status).toBe(400)
    expect((await handleRooms(new Request('https://app.test/api/rooms/BCDF/socket?role=player&nick=Alex&pid=player_01'), f.env)).status).toBe(426)
    expect((await handleRooms(new Request('https://app.test/api/rooms/BCDF'), f.env)).status).toBe(404)
  })
  it('checks same origin and rejects an unknown quiz', async () => {
    const f = fixture({ quiz: null })
    const wrongOrigin = new Request('https://app.test/api/rooms', { method: 'POST', headers: { Origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{"quiz":"quiz123"}' })
    expect((await handleRooms(wrongOrigin, f.env)).status).toBe(403)
    expect((await handleRooms(f.post(), f.env)).status).toBe(404)
  })
  it('checks host tokens and forwards valid roles', async () => {
    const f = fixture(), created = await handleRooms(f.post(), f.env), body = await created.json() as { code: string; hostToken: string }
    const bad = new Request(`https://app.test/api/rooms/${body.code}/socket?role=host&token=no`, { headers: { Upgrade: 'websocket' } })
    expect((await handleRooms(bad, f.env)).status).toBe(403)
    const good = new Request(`https://app.test/api/rooms/${body.code}/socket?role=host&token=${body.hostToken}`, { headers: { Upgrade: 'websocket' } })
    expect((await handleRooms(good, f.env)).status).toBe(202)
  })
  it('enforces visitor and daily creation limits', async () => {
    const perVisitor = fixture()
    for (let i = 0; i < ROOMS_PER_VISITOR_PER_DAY; i++) expect((await handleRooms(perVisitor.post(), perVisitor.env)).status).toBe(201)
    expect((await handleRooms(perVisitor.post(), perVisitor.env)).status).toBe(429)
    const total = fixture()
    for (let i = 0; i < ROOMS_PER_DAY; i++) expect((await handleRooms(total.post(`10.0.0.${i}`), total.env)).status).toBe(201)
    expect((await handleRooms(total.post('10.1.1.1'), total.env)).status).toBe(429)
  })
})
