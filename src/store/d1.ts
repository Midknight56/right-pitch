import type { Cache, QuotaReading, QuotaStore } from '../qloo/client'
import { MAX_CALL_NEURONS } from '../limits'

/** Neurons held for one model call; settle writes what the call really cost. */
export interface Reservation { settle(neurons: number): Promise<void> }
export interface Budget { reserve(): Promise<Reservation | null> }

interface Stmt {
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}
interface D1Like { prepare(sql: string): { bind(...v: unknown[]): Stmt } }

interface CacheRow { body: string; expires_at: number }

export class D1Cache implements Cache {
  constructor(private db: D1Like, private now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT body, expires_at FROM qloo_cache WHERE key = ?').bind(key).first<CacheRow>()
    return row && row.expires_at > this.now() ? row.body : null
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const ttl = opts?.expirationTtl ?? 60 * 24 * 60 * 60
    await this.db.prepare('INSERT INTO qloo_cache (key, body, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at')
      .bind(key, value, this.now() + ttl * 1000).run()
  }
}

/** The shared Qloo key's calls left this month, one row, from the last live answer. */
export class D1Quota implements QuotaStore {
  constructor(private db: D1Like) {}

  async read(): Promise<QuotaReading | null> {
    return this.db.prepare('SELECT remaining, at FROM qloo_quota WHERE id = 1').bind().first<QuotaReading>()
  }

  async record(remaining: number, at: number): Promise<void> {
    await this.db.prepare('INSERT INTO qloo_quota (id, remaining, at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET remaining = excluded.remaining, at = excluded.at')
      .bind(Math.floor(remaining), at).run()
  }
}

export class RunCache {
  constructor(private db: D1Like, private now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT events FROM run_cache WHERE key = ?').bind(key).first<{ events: string }>()
    return row?.events ?? null
  }

  async put(key: string, events: string): Promise<void> {
    await this.db.prepare('INSERT INTO run_cache (key, events, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET events = excluded.events, created_at = excluded.created_at')
      .bind(key, events, this.now()).run()
  }
}

export class NeuronLedger implements Budget {
  private day: () => string
  constructor(private db: D1Like, private opts: { app: string; dailyCap: number; accountCap: number; reserve?: number; day?: () => string }) {
    this.day = opts.day ?? (() => new Date().toISOString().slice(0, 10))
  }

  async spentToday(): Promise<{ app: number; all: number }> {
    const day = this.day()
    const appRow = await this.db.prepare('SELECT COALESCE(SUM(neurons), 0) AS total FROM ai_calls WHERE day = ? AND app = ?').bind(day, this.opts.app).first<{ total: number }>()
    const allRow = await this.db.prepare('SELECT COALESCE(SUM(neurons), 0) AS total FROM ai_calls WHERE day = ?').bind(day).first<{ total: number }>()
    return { app: appRow?.total ?? 0, all: allRow?.total ?? 0 }
  }

  async allow(): Promise<boolean> {
    const spent = await this.spentToday()
    const reserve = this.opts.reserve ?? MAX_CALL_NEURONS
    return spent.app + reserve <= this.opts.dailyCap && spent.all + reserve <= this.opts.accountCap
  }

  async reserve(): Promise<Reservation | null> {
    const day = this.day()
    const neurons = this.opts.reserve ?? MAX_CALL_NEURONS
    const row = await this.db.prepare('INSERT INTO ai_calls (app, day, neurons) SELECT ?, ?, ? WHERE (SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE day = ? AND app = ?) + ? <= ? AND (SELECT COALESCE(SUM(neurons),0) FROM ai_calls WHERE day = ?) + ? <= ? RETURNING id')
      .bind(this.opts.app, day, neurons, day, this.opts.app, neurons, this.opts.dailyCap, day, neurons, this.opts.accountCap).first<{ id: number }>()
    if (!row) return null
    return {
      settle: async (spent) => {
        await this.db.prepare('UPDATE ai_calls SET neurons = ? WHERE id = ?').bind(spent, row.id).run()
      },
    }
  }
}
