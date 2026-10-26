import { QLOO_CALL_GAP_MS, QLOO_MONTH_FLOOR, QLOO_QUOTA_READING_MS } from '../limits'

export const QLOO_BASE = 'https://hackathon.api.qloo.com'
export const CACHE_SECONDS = 60 * 24 * 60 * 60

export interface RawEntity {
  entity_id?: string
  name?: string
  types?: string[]
  subtype?: string
  popularity?: number
  properties?: Record<string, unknown>
  external?: Record<string, unknown>
  query?: { affinity?: number; [key: string]: unknown }
}

export interface Cache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface Answer<T> {
  results: T[]
  cached: boolean
  ms: number
}

export class QlooError extends Error {}

export class QlooBusy extends QlooError {
  constructor() {
    super('Qloo call limit reached.')
  }
}

export class QlooOff extends QlooError {
  constructor() {
    super('Live Qloo is off right now.')
  }
}

export class QlooQuotaLow extends QlooError {
  constructor() {
    super('Live building is paused for now. Presets still work.')
  }
}

/** The key's calls left this month, as read from the last live answer. */
export interface QuotaReading { remaining: number; at: number }
export interface QuotaStore {
  read(): Promise<QuotaReading | null>
  record(remaining: number, at: number): Promise<void>
}

/** True while a fresh reading says the month is under the floor. A missing or old reading lets a call through. */
export function quotaLow(reading: QuotaReading | null, now: number): boolean {
  return Boolean(reading && now - reading.at < QLOO_QUOTA_READING_MS && reading.remaining < QLOO_MONTH_FLOOR)
}

export interface ClientOptions {
  quota?: QuotaStore
  gapMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

interface QlooResponse {
  body: Record<string, unknown>
  cached: boolean
  ms: number
}

export class QlooClient {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch,
    private readonly cache: Cache,
    private readonly allow: () => Promise<boolean>,
    private readonly options: ClientOptions = {},
  ) {}

  private lastCall = -Infinity

  async insights(params: Record<string, string>): Promise<Answer<RawEntity>> {
    const response = await this.get('/v2/insights', params)
    const result = response.body.results as { entities?: RawEntity[] } | undefined
    return { results: result?.entities ?? [], cached: response.cached, ms: response.ms }
  }

  async search(query: string, type?: string, take = 5): Promise<Answer<RawEntity>> {
    const params: Record<string, string> = { query: query.trim(), take: String(take) }
    if (type) params.types = type.startsWith('urn:entity:') ? type : `urn:entity:${type}`
    const response = await this.get('/search', params)
    return {
      results: response.body.results as RawEntity[],
      cached: response.cached,
      ms: response.ms,
    }
  }

  private async get(path: string, params: Record<string, string>): Promise<QlooResponse> {
    // Stable ordering makes equivalent parameter objects share the same cache entry.
    const sortedParams = Object.entries(params).sort(([left], [right]) => left.localeCompare(right))
    const query = new URLSearchParams(sortedParams).toString()
    const cacheKey = query ? `${path}?${query}` : path
    const startedAt = Date.now()
    const cachedBody = await this.cache.get(cacheKey)
    if (cachedBody) {
      try {
        const body = JSON.parse(cachedBody) as Record<string, unknown>
        if (this.isValidBody(path, body)) {
          return { body, cached: true, ms: Date.now() - startedAt }
        }
      } catch {
        // Invalid cache entries are treated as misses.
      }
    }
    if (!this.key) throw new QlooOff()
    const now = this.options.now ?? Date.now
    if (this.options.quota && quotaLow(await this.options.quota.read(), now())) throw new QlooQuotaLow()
    if (!(await this.allow())) throw new QlooBusy()

    // Live calls in one build are spaced out to stay under the key's 10 a second.
    const gap = this.options.gapMs ?? QLOO_CALL_GAP_MS
    const waitFor = this.lastCall + gap - now()
    if (waitFor > 0) await (this.options.wait ?? ((ms: number) => new Promise((done) => setTimeout(done, ms))))(waitFor)
    this.lastCall = now()
    const response = await this.fetchUpstream(cacheKey)
    const left = Number(response.headers.get('X-Month-RateLimit-Remaining') ?? NaN)
    if (this.options.quota && response.headers.has('X-Month-RateLimit-Remaining') && Number.isFinite(left)) {
      await this.options.quota.record(left, now())
    }
    if (response.status === 429) throw new QlooBusy()
    if (response.status === 404) {
      const body = path === '/search' ? { results: [] } : { results: { entities: [] } }
      return { body, cached: false, ms: Date.now() - startedAt }
    }
    if (!response.ok) await this.throwHttpError(response)
    const body = await this.readBody(response)
    if (!this.isValidBody(path, body)) throw new QlooError('Qloo returned an incomplete answer.')
    await this.cache.put(cacheKey, JSON.stringify(body), { expirationTtl: CACHE_SECONDS })
    return { body, cached: false, ms: Date.now() - startedAt }
  }

  private async fetchUpstream(cacheKey: string): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    // Called as a plain function: the Workers fetch refuses to run as a method of this client ("Illegal invocation").
    const fetcher = this.fetcher
    try {
      return await fetcher(QLOO_BASE + cacheKey, {
        method: 'GET',
        headers: { 'X-Api-Key': this.key, Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch {
      throw new QlooError('Qloo is not answering right now.')
    } finally {
      clearTimeout(timeout)
    }
  }

  private async throwHttpError(response: Response): Promise<never> {
    let message = ''
    try {
      const body = await response.json() as { errors?: { message?: string }[] }
      message = body.errors?.[0]?.message ?? ''
    } catch {
      // Some upstream failures have no JSON body.
    }
    if (this.key) message = message.split(this.key).join('[redacted]')
    throw new QlooError(message ? `Qloo said: ${message}` : `Qloo said: HTTP ${response.status}`)
  }

  private async readBody(response: Response): Promise<Record<string, unknown>> {
    try {
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object')
      return body as Record<string, unknown>
    } catch {
      throw new QlooError('Qloo returned an unreadable answer.')
    }
  }

  private isValidBody(path: string, body: Record<string, unknown>): boolean {
    if (path === '/search') return Array.isArray(body.results)
    const result = body.results
    return Boolean(result && typeof result === 'object' && !Array.isArray(result)
      && Array.isArray((result as { entities?: unknown }).entities))
  }
}
