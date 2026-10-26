import type { AiBinding } from '../agent/model'
import { WorkersAiModel } from '../agent/model'
import { DAILY_BUILDS_PER_VISITOR, DAILY_NEURONS, DAILY_QLOO_CALLS, DAILY_QLOO_CALLS_PER_VISITOR } from '../limits'
import { DEFAULT_ACCOUNT_NEURONS, MAX_CALL_NEURONS, REPLAY_PACE_MS } from '../limits'
import { buildQuiz } from '../quiz/build'
import { PRESETS } from '../quiz/presets'
import { AGES, ROUND_KINDS } from '../quiz/types'
import type { Age, BuildEvent, RoundKind, Setup } from '../quiz/types'
import { D1Cache, D1Quota, NeuronLedger, RunCache } from '../store/d1'
import { QlooClient, QlooQuotaLow, quotaLow } from '../qloo/client'
import { allowBuild, allowQlooCall } from './caps'

interface Statement {
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}

interface Database {
  prepare(sql: string): { bind(...values: unknown[]): Statement }
}

interface CounterNamespace {
  idFromName(name: string): unknown
  get(id: unknown): { take(day: string, limit: number): Promise<boolean> }
}

interface AppEnv {
  DB: Database
  LEDGER?: Database
  SESSION_SECRET: string
  QLOO_API_KEY?: string
  AI?: AiBinding
  COUNTERS: CounterNamespace
  DAILY_NEURONS?: string
  ACCOUNT_NEURONS?: string
  BUILDS_PER_VISITOR?: string
  QLOO_CALLS_PER_VISITOR?: string
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

const jsonHeaders = { 'content-type': 'application/json' }
const streamHeaders = { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' }

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders })
}

function validSetup(value: unknown): value is Setup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const setup = value as Record<string, unknown>
  if (typeof setup.town !== 'string' || setup.town.trim().length < 1 || setup.town.trim().length > 40) return false
  // Letters and a region after a comma: "Glasgow, Scotland" (plain "Glasgow" found a town in Kentucky).
  if (!/^[\p{L} .',-]+$/u.test(setup.town)) return false
  if (!Array.isArray(setup.crowd) || setup.crowd.length < 1 || setup.crowd.length > 6) return false
  if (!setup.crowd.every((age) => AGES.includes(age as Age))) return false
  if (new Set(setup.crowd).size !== setup.crowd.length) return false
  if (!['easy', 'mixed', 'hard'].includes(String(setup.difficulty))) return false
  if (!Array.isArray(setup.rounds) || setup.rounds.length !== 4) return false
  if (new Set(setup.rounds).size !== 4) return false
  if (!setup.rounds.every((kind) => ROUND_KINDS.includes(kind as RoundKind))) return false
  if (setup.seeds !== undefined) {
    if (!Array.isArray(setup.seeds) || setup.seeds.length > 3) return false
    if (!setup.seeds.every((seed) => typeof seed === 'string'
      && seed.trim().length >= 1 && seed.length <= 40)) return false
  }
  if (setup.night !== undefined && typeof setup.night !== 'string') return false
  return true
}

/** The setup in one fixed shape and key order: it is also the replay key, so the same night always finds its recording. */
function normalizeSetup(setup: Setup): Setup {
  const seeds = (setup.seeds ?? []).map((seed) => seed.trim()).filter(Boolean).sort()
  const night = setup.night?.trim()
  return {
    town: setup.town.trim().replace(/\s+/g, ' '),
    crowd: [...setup.crowd].sort(),
    difficulty: setup.difficulty,
    rounds: [...setup.rounds],
    ...(seeds.length ? { seeds } : {}),
    ...(night ? { night } : {}),
  }
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

async function visitorId(request: Request, secret: string): Promise<string> {
  // Keep only a short salted digest of the visitor address in persistent history.
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const input = new TextEncoder().encode(`${secret}:${address}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function counter(env: AppEnv, name: string) {
  return env.COUNTERS.get(env.COUNTERS.idFromName(name))
}

export function handlePresets(request?: Request): Response {
  if (request && request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  return jsonResponse(PRESETS)
}

export async function handleBuild(
  request: Request,
  rawEnv: unknown,
  context: ExecutionContextLike,
): Promise<Response> {
  const env = rawEnv as AppEnv
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!hasSameOrigin(request)) return new Response('Forbidden', { status: 403 })

  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 12_000) throw new Error('Request body too large')
    body = JSON.parse(text) as unknown
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }
  const submitted = body && typeof body === 'object' ? (body as { setup?: unknown }).setup : undefined
  if (!validSetup(submitted)) return jsonResponse({ error: 'Invalid setup.' }, 400)

  const setup = normalizeSetup(submitted)
  const cacheKey = JSON.stringify(setup)
  const runCache = new RunCache(env.DB)
  const savedEvents = await runCache.get(cacheKey)
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()
  const send = async (event: BuildEvent) => {
    await writer.write(encoder.encode(`${JSON.stringify(event)}\n`))
  }

  const work = async () => {
    try {
      if (savedEvents) {
        await replayEvents(savedEvents, send)
        return
      }
      if (!env.QLOO_API_KEY) {
        await send({ t: 'start', mode: 'off', quiz: '' })
        await send({ t: 'error', text: 'Live building is off. Presets still work.' })
        return
      }

      // The shared key's month is nearly used: no fresh build, so no model call or visitor build is spent on one that
      // cannot ask Qloo. Recorded builds above still play.
      const quota = new D1Quota(env.DB)
      if (quotaLow(await quota.read(), Date.now())) {
        await send({ t: 'start', mode: 'off', quiz: '' })
        await send({ t: 'error', text: new QlooQuotaLow().message })
        return
      }

      const host = await visitorId(request, env.SESSION_SECRET)
      const buildLimit = Number(env.BUILDS_PER_VISITOR ?? DAILY_BUILDS_PER_VISITOR)
      if (!(await allowBuild(counter(env, `builds:${host}`), today(), buildLimit))) {
        await send({ t: 'error', text: 'Daily build limit reached.' })
        return
      }

      const qloo = new QlooClient(env.QLOO_API_KEY, fetch, new D1Cache(env.DB), async () => {
        return allowQlooCall(
          counter(env, `visitor:${host}`), counter(env, 'qloo-total'), today(),
          Number(env.QLOO_CALLS_PER_VISITOR ?? DAILY_QLOO_CALLS_PER_VISITOR), DAILY_QLOO_CALLS,
        )
      }, { quota })
      const ledger = new NeuronLedger(env.LEDGER ?? env.DB, {
        app: 'right-pitch',
        dailyCap: Number(env.DAILY_NEURONS ?? DAILY_NEURONS),
        accountCap: Number(env.ACCOUNT_NEURONS ?? DEFAULT_ACCOUNT_NEURONS),
        reserve: MAX_CALL_NEURONS,
      })
      const history = await env.DB.prepare(
        'SELECT qloo_id FROM host_history WHERE host = ? ORDER BY used_at DESC LIMIT 40',
      ).bind(host).all<{ qloo_id: string }>()
      const events: BuildEvent[] = []
      const quiz = await buildQuiz(setup, {
        qloo,
        model: env.AI ? new WorkersAiModel(env.AI) : null,
        budget: ledger,
        history: history.results.map((row) => row.qloo_id),
      }, async (event) => {
        events.push(event)
        await send(event)
      })
      await saveQuiz(env.DB, quiz)
      await saveHistory(env.DB, host, quiz)
      await runCache.put(cacheKey, JSON.stringify(events))
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Build failed.'
      await send({ t: 'error', text })
    } finally {
      await writer.close()
    }
  }
  const task = work()
  context.waitUntil(task)
  return new Response(stream.readable, { headers: streamHeaders })
}

async function replayEvents(encoded: string, send: (event: BuildEvent) => Promise<void>): Promise<void> {
  const events = JSON.parse(encoded) as BuildEvent[]
  for (const event of events) {
    let replay = event
    if (event.t === 'start') replay = { ...event, mode: 'cache' }
    if (event.t === 'call') replay = { ...event, cached: true }
    if (event.t === 'usage') replay = { ...event, qloo: 0, neurons: 0 }
    if (event.t === 'done') {
      replay = { ...event, quiz: { ...event.quiz, mode: 'cache', qlooCalls: 0, neurons: 0 } }
    }
    await send(replay)
    // Pace cached runs so the live build log remains readable.
    await new Promise((resolve) => setTimeout(resolve, REPLAY_PACE_MS))
  }
}

async function saveQuiz(database: Database, quiz: import('../quiz/types').Quiz): Promise<void> {
  await database.prepare('INSERT OR REPLACE INTO quizzes (id, quiz, created_at) VALUES (?, ?, ?)')
    .bind(quiz.id, JSON.stringify(quiz), quiz.createdAt).run()
}

async function saveHistory(database: Database, host: string, quiz: import('../quiz/types').Quiz): Promise<void> {
  const ids = new Set(quiz.rounds.flatMap((round) => round.questions.flatMap((question) => {
    const optionIds = question.options.flatMap((option) => option.record ? [option.record.qlooId] : [])
    return question.item ? [...optionIds, question.item.qlooId] : optionIds
  })))
  for (const id of ids) {
    await database.prepare('INSERT OR IGNORE INTO host_history (host, qloo_id, used_at) VALUES (?, ?, ?)')
      .bind(host, id, Date.now()).run()
  }
}

export async function handleQuiz(request: Request, rawEnv: unknown): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const env = rawEnv as AppEnv
  const id = new URL(request.url).pathname.split('/').pop() ?? ''
  const row = await env.DB.prepare('SELECT quiz FROM quizzes WHERE id = ?').bind(id).first<{ quiz: string }>()
  return row
    ? new Response(row.quiz, { headers: jsonHeaders })
    : jsonResponse({ error: 'Quiz not found.' }, 404)
}

export async function handleReport(request: Request, rawEnv: unknown): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!hasSameOrigin(request)) return new Response('Forbidden', { status: 403 })
  const env = rawEnv as AppEnv
  let body: unknown
  try {
    body = await request.json() as unknown
  } catch {
    return jsonResponse({ error: 'Invalid JSON.' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Invalid report.' }, 400)
  const report = body as Record<string, unknown>
  if (typeof report.quiz !== 'string' || typeof report.question !== 'string'
    || typeof report.why !== 'string' || report.why.length > 300) {
    return jsonResponse({ error: 'Invalid report.' }, 400)
  }
  await env.DB.prepare('INSERT INTO reports (quiz, question, why, at) VALUES (?, ?, ?, ?)')
    .bind(report.quiz, report.question, report.why, Date.now()).run()
  return jsonResponse({ ok: true }, 201)
}
