import { describe, expect, it, vi } from 'vitest'
import { QlooClient, QlooError, QlooQuotaLow, type QuotaReading } from '../../src/qloo/client'
import { QLOO_CALL_GAP_MS, QLOO_MONTH_FLOOR, QLOO_QUOTA_READING_MS } from '../../src/limits'

function cache() {
  const entries = new Map<string, string>()
  return {
    entries,
    get: async (key: string) => entries.get(key) ?? null,
    put: async (key: string, value: string) => { entries.set(key, value) },
  }
}

describe('Qloo client', () => {
  it('calls fetch as a plain function, as the Workers runtime requires', async () => {
    // The Workers fetch throws "Illegal invocation" when it is called as a method of another object.
    async function workersFetch(this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      return Response.json({ results: { entities: [] } })
    }
    const client = new QlooClient('fake-secret', workersFetch as typeof fetch, cache(), async () => true)
    await expect(client.insights({ 'filter.type': 'urn:entity:movie' })).resolves.toMatchObject({ results: [] })
  })

  it('returns raw insight entities, sorted cache keys, and timing metadata', async () => {
    const stored = cache()
    let request: Request | undefined
    const client = new QlooClient('fake-secret', async (input, init) => {
      request = new Request(input, init)
      return Response.json({ results: { entities: [{ entity_id: 'synthetic-id', name: 'Harbour Lights', properties: { release_year: 1990 }, query: { affinity: 0.7 } }] } })
    }, stored, async () => true)
    const result = await client.insights({ 'signal.location.query': 'Halifax', 'filter.type': 'urn:entity:movie' })
    expect(result.results[0].entity_id).toBe('synthetic-id')
    expect(result.results[0].properties?.release_year).toBe(1990)
    expect(result.results[0].query?.affinity).toBe(0.7)
    expect(result.cached).toBe(false)
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(request?.method).toBe('GET')
    expect(request?.headers.get('X-Api-Key')).toBe('fake-secret')
    expect([...stored.entries.keys()][0]).toBe('/v2/insights?filter.type=urn%3Aentity%3Amovie&signal.location.query=Halifax')
    const cached = await client.insights({ 'filter.type': 'urn:entity:movie', 'signal.location.query': 'Halifax' })
    expect(cached.cached).toBe(true)
  })

  it('redacts the credential from upstream errors', async () => {
    const client = new QlooClient('fake-secret', async () => new Response(
      JSON.stringify({ errors: [{ message: 'bad fake-secret' }] }), { status: 400 },
    ), cache(), async () => true)
    await expect(client.search('Harbour Lights')).rejects.toThrow('bad [redacted]')
    await expect(client.search('Harbour Lights')).rejects.toBeInstanceOf(QlooError)
  })
})

describe('the shared key month and its pace', () => {
  function quota(start: QuotaReading | null = null) {
    let reading = start
    return {
      get reading() { return reading },
      read: async () => reading,
      record: async (remaining: number, at: number) => { reading = { remaining, at } },
    }
  }
  const answer = (left: string) => async () => Response.json({ results: { entities: [] } }, { headers: { 'X-Month-RateLimit-Remaining': left } })

  it('stores the calls left from each live answer', async () => {
    const store = quota()
    const client = new QlooClient('fake-secret', answer('41234'), cache(), async () => true, { quota: store, now: () => 5_000, wait: async () => undefined })
    await client.insights({ 'filter.type': 'urn:entity:movie' })
    expect(store.reading).toEqual({ remaining: 41234, at: 5_000 })
  })

  it('makes no live call while a fresh reading is under the floor, and still serves cached answers', async () => {
    const stored = cache()
    stored.entries.set('/v2/insights?filter.type=urn%3Aentity%3Amovie', JSON.stringify({ results: { entities: [{ entity_id: 'synthetic-id' }] } }))
    const fetcher = vi.fn(answer('2999'))
    const client = new QlooClient('fake-secret', fetcher, stored, async () => true, {
      quota: quota({ remaining: QLOO_MONTH_FLOOR - 1, at: 1_000 }), now: () => 2_000, wait: async () => undefined,
    })
    await expect(client.insights({ 'filter.type': 'urn:entity:tv_show' })).rejects.toBeInstanceOf(QlooQuotaLow)
    expect(fetcher).not.toHaveBeenCalled()
    await expect(client.insights({ 'filter.type': 'urn:entity:movie' })).resolves.toMatchObject({ cached: true })
  })

  it('lets one call read the month again once the reading is old', async () => {
    const store = quota({ remaining: 10, at: 0 })
    const fetcher = vi.fn(answer('50000'))
    const client = new QlooClient('fake-secret', fetcher, cache(), async () => true, {
      quota: store, now: () => QLOO_QUOTA_READING_MS + 1, wait: async () => undefined,
    })
    await client.insights({ 'filter.type': 'urn:entity:movie' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(store.reading?.remaining).toBe(50000)
  })

  it('waits between live calls so a build stays under 10 a second', async () => {
    let clock = 0
    const waits: number[] = []
    const client = new QlooClient('fake-secret', answer('40000'), cache(), async () => true, {
      now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms },
    })
    for (const type of ['movie', 'tv_show', 'book']) await client.insights({ 'filter.type': `urn:entity:${type}` })
    expect(waits).toEqual([QLOO_CALL_GAP_MS, QLOO_CALL_GAP_MS])
    expect(1000 / QLOO_CALL_GAP_MS).toBeLessThan(10)
  })
})
