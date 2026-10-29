import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleBuild, handleQuiz, handleReport } from '../../src/app/build'
import { FakeD1 } from './fake-d1'
import type { Setup } from '../../src/quiz/types'
import { setClock } from '../../src/limits'

const setup: Setup = {
  town: 'Halifax',
  crowd: ['30_to_34', '35_to_44'],
  difficulty: 'mixed',
  rounds: ['film', 'music', 'generation', 'local'],
}

const databases: FakeD1[] = []
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { entities: [] } })))
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  vi.unstubAllGlobals()
  setClock(null)
})

function environment(options: { key?: string; buildLimit?: string } = {}) {
  const database = new FakeD1()
  databases.push(database)
  const counts = new Map<string, number>()
  const limits = new Map<string, number>()
  const env = {
    DB: database,
    SESSION_SECRET: 'test-salt',
    QLOO_API_KEY: options.key,
    BUILDS_PER_VISITOR: options.buildLimit,
    COUNTERS: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        take: async (_day: string, limit: number) => {
          const count = counts.get(id) ?? 0
          limits.set(id, limit)
          if (count + 1 > limit) return false
          counts.set(id, count + 1)
          return true
        },
      }),
    },
    counts,
    limits,
  }
  return { database, env }
}

async function buildRequest(body: unknown, origin?: string) {
  const headers = new Headers({ 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.25' })
  if (origin) headers.set('Origin', origin)
  return new Request('https://right-pitch.test/api/build', {
    method: 'POST', headers, body: JSON.stringify(body),
  })
}

async function runBuild(request: Request, env: unknown): Promise<{ response: Response; body: string }> {
  const pending: Promise<unknown>[] = []
  const response = await handleBuild(request, env, { waitUntil: (promise) => pending.push(promise) })
  const body = await response.text()
  await Promise.all(pending)
  return { response, body }
}

describe('build route', () => {
  it('rejects malformed setups and cross origin requests', async () => {
    const { env } = environment()
    const badSetups = [
      { ...setup, town: '' },
      { ...setup, town: 'Halifax 2' },
      { ...setup, seeds: ['a', 'b', 'c', 'd'] },
      { ...setup, crowd: [] },
      { ...setup, crowd: ['not_an_age'] },
      { ...setup, crowd: ['30_to_34', '30_to_34'] },
      { ...setup, seeds: [' '.repeat(3)] },
      { ...setup, seeds: ['x'.repeat(41)] },
      { ...setup, rounds: ['film', 'film', 'music', 'local'] },
      { ...setup, rounds: ['film', 'music', 'local'] },
    ]
    for (const invalid of badSetups) {
      const response = await handleBuild(await buildRequest({ setup: invalid }), env, { waitUntil: () => undefined })
      expect(response.status).toBe(400)
    }
    const forbidden = await handleBuild(
      await buildRequest({ setup }, 'https://evil.test'), env, { waitUntil: () => undefined },
    )
    expect(forbidden.status).toBe(403)
    const tooLarge = new Request('https://right-pitch.test/api/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(12_001),
    })
    const largeResponse = await handleBuild(tooLarge, env, { waitUntil: () => undefined })
    expect(largeResponse.status).toBe(400)
  })

  it('returns off mode without a key and does not take a visitor build', async () => {
    const { env } = environment()
    const result = await runBuild(await buildRequest({ setup }), env)
    expect(result.response.status).toBe(200)
    expect(env.counts.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses the third uncached visitor build', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const { env } = environment({ key: 'synthetic-key', buildLimit: '2' })
    for (let index = 0; index < 3; index++) {
      const result = await runBuild(await buildRequest({ setup: { ...setup, night: `case-${index}` } }), env)
      expect(result.response.status).toBe(200)
      if (index === 2) expect(result.body).toContain('Daily build limit reached.')
    }
    const buildCounter = [...env.counts.entries()].find(([name]) => name.startsWith('builds:'))
    expect(buildCounter?.[1]).toBe(2)
  })

  it('allows eight visitor builds during judging and refuses the ninth', async () => {
    setClock(() => Date.UTC(2026, 10, 3))
    vi.stubGlobal('fetch', fetchMock)
    const { env } = environment({ key: 'synthetic-key' })
    for (let index = 0; index < 9; index++) {
      const result = await runBuild(await buildRequest({ setup: { ...setup, night: `judging-${index}` } }), env)
      if (index === 8) expect(result.body).toContain('Daily build limit reached.')
      else expect(result.body).not.toContain('Daily build limit reached.')
    }
  })

  it('keeps the normal visitor build cap before judging', async () => {
    setClock(() => Date.UTC(2026, 10, 1))
    vi.stubGlobal('fetch', fetchMock)
    const { env } = environment({ key: 'synthetic-key' })
    for (let index = 0; index < 3; index++) {
      const result = await runBuild(await buildRequest({ setup: { ...setup, night: `before-${index}` } }), env)
      if (index === 2) expect(result.body).toContain('Daily build limit reached.')
      else expect(result.body).not.toContain('Daily build limit reached.')
    }
  })

  it('starts no fresh build while the shared key month is under the floor', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    const { database, env } = environment({ key: 'synthetic-key' })
    await database.prepare('INSERT INTO qloo_quota (id, remaining, at) VALUES (1, ?, ?)').bind(2999, Date.now()).run()
    const result = await runBuild(await buildRequest({ setup: { ...setup, night: 'quota' } }), env)
    expect(result.body).toContain('"mode":"off"')
    expect(result.body).toContain('Live building is paused for now.')
    expect(env.counts.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('replays a cached setup without taking a visitor build', async () => {
    const { database, env } = environment({ key: 'synthetic-key' })
    const events = [
      { t: 'start', mode: 'live', quiz: 'cached-id' },
      { t: 'call', round: 0, path: '/v2/insights', params: {}, results: 3, ms: 1, cached: false },
      { t: 'usage', qloo: 9, neurons: 15 },
      { t: 'done', quiz: { id: 'cached-id', mode: 'live', qlooCalls: 7, neurons: 12 } },
    ]
    const normalized = { ...setup, crowd: [...setup.crowd].sort(), rounds: [...setup.rounds] }
    await database.prepare('INSERT INTO run_cache (key, events, created_at) VALUES (?, ?, ?)')
      .bind(JSON.stringify(normalized), JSON.stringify(events), Date.now()).run()
    const result = await runBuild(await buildRequest({ setup }), env)
    expect(result.response.status).toBe(200)
    expect(result.body).toContain('"mode":"cache"')
    expect(result.body).toContain('"cached":true')
    expect(result.body).toContain('"qloo":0,"neurons":0')
    expect(env.counts.size).toBe(0)
    // The same night sent with its keys in another order, a padded town and empty seeds still finds the recording.
    const shuffled = { seeds: [], rounds: [...setup.rounds], difficulty: setup.difficulty, crowd: [...setup.crowd].reverse(), town: `  ${setup.town} ` }
    const again = await runBuild(await buildRequest({ setup: shuffled }), env)
    expect(again.body).toContain('"mode":"cache"')
    expect(env.counts.size).toBe(0)
  })

  it('reads saved quizzes and writes bounded wrong answer reports', async () => {
    const { database, env } = environment()
    await database.prepare('INSERT INTO quizzes (id, quiz, created_at) VALUES (?, ?, ?)')
      .bind('synthetic-quiz', JSON.stringify({ id: 'synthetic-quiz' }), Date.now()).run()
    const quiz = await handleQuiz(new Request('https://right-pitch.test/api/quiz/synthetic-quiz'), env)
    expect(quiz.status).toBe(200)
    const tooLong = await handleReport(new Request('https://right-pitch.test/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quiz: 'synthetic-quiz', question: 'q1', why: 'x'.repeat(301) }),
    }), env)
    expect(tooLong.status).toBe(400)
    const accepted = await handleReport(new Request('https://right-pitch.test/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quiz: 'synthetic-quiz', question: 'q1', why: 'The answer looked wrong.' }),
    }), env)
    expect(accepted.status).toBe(201)
    const reports = await database.prepare('SELECT why FROM reports').bind().all<{ why: string }>()
    expect(reports.results).toEqual([{ why: 'The answer looked wrong.' }])
  })
})
