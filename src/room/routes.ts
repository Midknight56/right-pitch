import type { Env } from '../worker'
import { ROOMS_PER_DAY, ROOMS_PER_VISITOR_PER_DAY } from '../limits'
import type { Quiz } from '../quiz/types'
import { refuse } from './refuse'

const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/
const PID = /^[A-Za-z0-9_-]{8,40}$/

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

async function hostToken(code: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code))
  const bytes = new Uint8Array(signature)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function visitor(request: Request, secret: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const hash = await digest(`${secret}:${ip}`)
  return [...hash.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

function error(text: string, status: number): Response {
  return Response.json({ error: text }, { status })
}

function roomStub(env: Env, code: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(code))
}

export async function handleRooms(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return error('Same-origin request required', 403)
    let body: { quiz?: unknown }
    try {
      body = await request.json() as typeof body
    } catch {
      return error('Invalid JSON', 400)
    }
    if (typeof body.quiz !== 'string') return error('Quiz id is required', 400)
    const row = await env.DB.prepare('SELECT quiz FROM quizzes WHERE id = ?').bind(body.quiz).first<{ quiz: string }>()
    if (!row) return error('Quiz not found', 404)
    let quiz: Quiz
    try { quiz = JSON.parse(row.quiz) as Quiz } catch { return error('Quiz is invalid', 500) }
    const now = Date.now()
    const day = new Date(now).toISOString().slice(0, 10)
    const visitorId = await visitor(request, env.SESSION_SECRET)
    const perVisitor = env.COUNTERS.get(env.COUNTERS.idFromName(`rooms:${visitorId}`))
    if (!await perVisitor.take(day, ROOMS_PER_VISITOR_PER_DAY)) {
      return error('Daily room limit reached for this visitor', 429)
    }
    const total = env.COUNTERS.get(env.COUNTERS.idFromName('rooms-total'))
    // Refusing the total cap still spends this visitor's room; that is the safe side.
    if (!await total.take(day, ROOMS_PER_DAY)) return error('Daily room limit reached', 429)
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode()
      const stub = roomStub(env, code)
      try {
        await (stub as unknown as {
          init(quiz: Quiz, code: string, now: number): Promise<void>
        }).init(quiz, code, now)
        return Response.json({ code, hostToken: await hostToken(code, env.SESSION_SECRET) }, { status: 201 })
      } catch (cause) {
        if (!(cause instanceof Error) || !cause.message.toLowerCase().includes('initialized')) {
          return error('Could not create room', 500)
        }
      }
    }
    return error('Could not allocate a room code', 503)
  }

  const match = /^\/api\/rooms\/([^/]+)(?:\/socket)?$/.exec(url.pathname)
  if (!match) return error('Not found', 404)
  const code = match[1]!
  if (!CODE.test(code)) return error('Invalid room code', 400)
  const stub = roomStub(env, code) as DurableObjectStub & {
    info?: () => Promise<{ exists: boolean; phase?: string; players?: number }>
  }
  if (url.pathname.endsWith('/socket')) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error('WebSocket upgrade required', 426)
    const role = url.searchParams.get('role')
    const headers = new Headers(request.headers)
    if (role === 'host') {
      const supplied = url.searchParams.get('token') ?? ''
      const expected = await hostToken(code, env.SESSION_SECRET)
      if (!same(supplied, expected)) return refuse('This is not the host link for this room.', 403)
      headers.set('x-role', 'host')
    } else if (role === 'player') {
      const nick = url.searchParams.get('nick') ?? ''
      const pid = url.searchParams.get('pid') ?? ''
      if (!nick.trim() || !PID.test(pid)) return refuse('Pick a nickname first.', 400)
      headers.set('x-role', 'player')
    } else return error('Invalid role', 400)
    return stub.fetch(new Request(request, { headers }))
  }
  const info = stub.info ? await stub.info() : { exists: false }
  if (!info.exists) return error('Room not found', 404)
  return Response.json({ exists: true, phase: info.phase, players: info.players })
}
