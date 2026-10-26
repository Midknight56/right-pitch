import { describe, expect, it } from 'vitest'
import { allowBuild, allowQlooCall, canMakeQlooCall } from '../../src/app/caps'

describe('daily caps', () => {
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
})

function makeCounter(results: boolean[]) {
  let index = 0
  return {
    take: async (_day: string, _limit: number) => results[index++] ?? false,
  }
}
