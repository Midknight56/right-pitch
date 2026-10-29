import { describe, expect, it } from 'vitest'
import { describeCall, esc, fieldLabel, localEnd, meterSpot, newPid } from '../../public/lib.js'
import { check } from '../../public/builder.js'

describe('page helpers', () => {
  it('counts down on the phone clock, not the room clock', () => {
    // The room says 20 s are left; the phone's clock runs 5 minutes behind the room's.
    const phoneNow = 1_000_000
    const roomNow = phoneNow + 300_000
    expect(localEnd({ endsAt: roomNow + 20_000, now: roomNow }, phoneNow)).toBe(phoneNow + 20_000)
    expect(localEnd({ endsAt: 5 }, 1)).toBe(5)
  })
  it('places popularity on the half to one meter', () => {
    expect(meterSpot(0.5)).toBe(0)
    expect(meterSpot(0.75)).toBe(50)
    expect(meterSpot(1)).toBe(100)
    expect(meterSpot(0.2)).toBe(0)
  })
  it('makes player ids the room accepts', () => {
    let seed = 0
    const id = newPid(() => (seed = (seed * 9301 + 49297) % 233280) / 233280)
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,40}$/)
    expect(newPid()).not.toBe(newPid())
  })
  it('escapes what a visitor typed', () => {
    expect(esc('<b onclick="x">&\'')).toBe('&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;')
  })
  it('describes a Qloo call in plain words', () => {
    const text = describeCall({
      path: '/v2/insights', results: 20, ms: 310, cached: false,
      params: { 'filter.type': 'urn:entity:movie', 'filter.popularity.min': '0.9', 'filter.popularity.max': '0.97', 'signal.location.query': 'Halifax', 'signal.demographics.age': '30_to_34,35_to_44' },
    })
    expect(text).toBe('insights movie, popularity 0.9 to 0.97, loved in Halifax, ages 30 to 34, 35 to 44. 20 back, 310 ms')
  })

  it('names a record field in words, every underscore gone, first letter capital', () => {
    // The record sheet showed "release year" beside "Type", and "date of_birth" (only the first underscore went).
    expect(fieldLabel('release_year')).toBe('Released')
    expect(fieldLabel('date_of_birth')).toBe('Born')
    expect(fieldLabel('business_rating')).toBe('Rating')
    expect(fieldLabel('some_new_field')).toBe('Some new field')
  })
})

describe('builder setup checks', () => {
  const setup = (town: string, seeds: string[] = []) => ({
    town,
    crowd: ['30_to_34'],
    rounds: ['film', 'music', 'generation', 'local'],
    seeds,
  })

  it('explains towns with digits or markup', () => {
    expect(check(setup('12345'))).toBe('A town is letters only, like Glasgow, Scotland.')
    expect(check(setup('<b>Halifax</b>'))).toBe('A town is letters only, like Glasgow, Scotland.')
  })

  it('explains towns over 40 characters', () => {
    expect(check(setup('a'.repeat(41)))).toBe('Keep the town to 40 letters or fewer.')
  })

  it('explains local names over 40 characters', () => {
    expect(check(setup('Halifax', ['a'.repeat(41)]))).toBe('Keep each local name to 40 letters or fewer.')
  })

  it('accepts town names allowed by the server', () => {
    expect(check(setup('Halifax, Nova Scotia'))).toBe('')
    expect(check(setup("St. John's, Newfoundland"))).toBe('')
  })
})

describe('host room status', () => {
  it('treats a missing room as gone', async () => {
    const { roomGone } = await import('../../public/lib.js')
    expect(roomGone(404)).toBe(true)
    expect(roomGone(200)).toBe(false)
  })
})
