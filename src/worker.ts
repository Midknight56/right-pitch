/// <reference types="@cloudflare/workers-types" />
// Right Pitch on Cloudflare Workers. docs/SPEC.md lists every route.
import { DurableObject } from 'cloudflare:workers'
import type { AiBinding } from './agent/model'
import { handleBuild, handlePresets, handleQuiz, handleReport } from './app/build'
import { handleRooms } from './room/routes'
import { Room } from './room/room'

export { Room }

export interface Env {
  /** Unset means no live Qloo: only cached builds and the recorded presets. */
  QLOO_API_KEY?: string
  SESSION_SECRET: string
  DB: D1Database
  /** The shared ledger of the hackathon apps' Workers AI use; this app's own DB when not bound. */
  LEDGER?: D1Database
  AI?: AiBinding
  ASSETS: Fetcher
  COUNTERS: DurableObjectNamespace<DailyCounter>
  ROOMS: DurableObjectNamespace<Room>
  /** Overrides for local test runs only; unset in production. */
  DAILY_NEURONS?: string
  ACCOUNT_NEURONS?: string
  BUILDS_PER_VISITOR?: string
  QLOO_CALLS_PER_VISITOR?: string
  /** "1" while the presets are recorded: Qloo is asked fresh. */
  RECORDING?: string
}

/** A day's count under one name: the whole Worker, or one visitor. SQLite backed storage. */
export class DailyCounter extends DurableObject<Env> {
  async take(day: string, limit: number): Promise<boolean> {
    const saved = (await this.ctx.storage.get<{ day: string; used: number }>('c')) ?? { day, used: 0 }
    const used = saved.day === day ? saved.used : 0
    if (used + 1 > limit) return false
    await this.ctx.storage.put('c', { day, used: used + 1 })
    return true
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/health') return new Response('ok')
    if (path === '/api/presets') return handlePresets(request)
    if (path === '/api/build') return handleBuild(request, env, ctx)
    if (path.startsWith('/api/quiz/')) return handleQuiz(request, env)
    if (path === '/api/report') return handleReport(request, env)
    if (path.startsWith('/api/rooms')) return handleRooms(request, env)
    // The host screen, the phone and the printable sheet are pages of the one app.
    if (/^\/(h|j)\/[A-Z]{4}\/?$/.test(path) || /^\/q\/[A-Za-z0-9_-]{6,48}\/print\/?$/.test(path)) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request))
    }
    return env.ASSETS.fetch(request)
  },
}
