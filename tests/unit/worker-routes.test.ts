import { describe, expect, it, vi } from 'vitest'
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))
import worker from '../../src/worker'

describe('worker page routes', () => {
  const env = { ASSETS: { fetch: async () => new Response('shell') } } as any
  const ctx = {} as any

  it.each([
    ['/j/zzzz', '/j/ZZZZ'],
    ['/h/AbCd/', '/h/ABCD'],
  ])('redirects lower case room path %s', async (path, expected) => {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, ctx)
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(`https://example.test${expected}`)
  })

  it('serves the shell for upper case room paths', async () => {
    const response = await worker.fetch(new Request('https://example.test/j/ZZZZ'), env, ctx)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('shell')
  })
})

