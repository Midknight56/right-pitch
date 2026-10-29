import { afterEach, describe, expect, it } from 'vitest'
import { allowBuild, allowQlooCall, canMakeQlooCall } from '../../src/app/caps'
import { perVisitorCaps, setClock } from '../../src/limits'

afterEach(() => setClock(null))

describe('daily caps', () => {
  it('uses normal and judging visitor caps at the exact UTC boundaries', () => {
    expect(perVisitorCaps(Date.UTC(2026, 10, 1, 23, 59))).toEqual({ builds: 2, qlooCalls: 40, rooms: 3 })
    expect(perVisitorCaps(Date.UTC(2026, 10, 2))).toEqual({ builds: 8, qlooCalls: 160, rooms: 12 })
    expect(perVisitorCaps(Date.UTC(2026, 10, 5, 23))).toEqual({ builds: 8, qlooCalls: 160, rooms: 12 })
    expect(perVisitorCaps(Date.UTC(2026, 10, 6, 12))).toEqual({ builds: 2, qlooCalls: 40, rooms: 3 })
    expect(perVisitorCaps(Date.UTC(2026, 10, 7))).toEqual({ builds: 2, qlooCalls: 40, rooms: 3 })
  })

  it('stops a build at 16 upstream calls', () => {
    expect(canMakeQlooCall(15)).toBe(true)
    expect(canMakeQlooCall(16)).toBe(false)
  })

  it('refuses a visitor after the build allowance is used', async () => {
    const counter = makeCounter([true, true, false])
    expect(await allowBuild(counter, 'day', 2)).toBe(true)
    expect(await allowBuild(counter, 'day', 2)).toBe(true)
    expect(await allowBuild(counter, 'day', 2)).toBe(false)
  })

  it('refuses a Qloo call when the visitor cap is exhausted', async () => {
    expect(await allowQlooCall(makeCounter([true]), makeCounter([true]), 'day', 40, 500)).toBe(true)
    expect(await allowQlooCall(makeCounter([false]), makeCounter([true]), 'day', 40, 500)).toBe(false)
  })

  it('refuses a Qloo call when the total cap is exhausted', async () => {
    expect(await allowQlooCall(makeCounter([true]), makeCounter([false]), 'day', 40, 500)).toBe(false)
  })

  it('keeps the whole app Qloo cap during judging', async () => {
    setClock(() => Date.UTC(2026, 10, 3))
    expect(await allowQlooCall(makeCounter([true]), makeCounter([false]), 'day', perVisitorCaps().qlooCalls, 500)).toBe(false)
  })
})

function makeCounter(results: boolean[]) {
  let index = 0
  return {
    take: async (_day: string, _limit: number) => results[index++] ?? false,
  }
}
