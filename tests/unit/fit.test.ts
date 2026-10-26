import { describe, expect, it } from 'vitest'
import { fitForRoom, namesItsArea, shortName, townName } from '../../src/quiz/fit'
import * as fields from '../../src/quiz/fields'
import { templatePlan } from '../../src/quiz/plan'
import { templates } from '../../src/quiz/templates'
import { makeEntities } from '../fixtures/entities'

describe('fit for the room', () => {
  it('keeps ordinary names and drops rude ones', () => {
    expect(fitForRoom('The Grapes of Wrath')).toBe(true)
    expect(fitForRoom('Scunthorpe United')).toBe(false) // the cost of a short list: a false drop, never a rude name shown
    expect(fitForRoom('Synthetic Thunderfuck')).toBe(false)
    expect(fitForRoom('Big Dick Energy')).toBe(false)
    expect(fitForRoom(undefined)).toBe(false)
  })
  it('spots a place whose name gives away its area', () => {
    expect(namesItsArea('Corner Shop Spryfield', 'Spryfield', 'Halifax')).toBe(true)
    expect(namesItsArea('Harbour Hotel Halifax', 'Downtown Halifax', 'Halifax')).toBe(false)
    expect(namesItsArea('North Street Diner', 'North End', 'Halifax')).toBe(false)
  })
  it('never asks about a place that names its own area', () => {
    const places = makeEntities('place', 3000, 0.8).slice(0, 4).map((place, index) => ({
      ...place,
      name: index === 0 ? 'Corner Shop Neighborhood 1' : `Plain Place ${index}`,
    }))
    for (let seed = 0; seed < 20; seed += 1) {
      let state = seed
      const rng = () => ((state = (state * 9301 + 49297) % 233280) / 233280)
      const question = templates.local_hood(places, rng, new Set(), { town: 'Halifax' })
      if ('why' in question) throw new Error(question.why)
      expect(question.prompt).not.toContain('Corner Shop')
    }
  })
  it('says the age reveal the right way round', () => {
    const pool = makeEntities('movie', 4000, 0.95).slice(0, 1)
    const id = pool[0].entity_id!
    const question = templates.generation_lean(pool, () => 0.5, new Set(), { young: new Map([[id, 0.2]]), old: new Map([[id, 0.7]]) })
    if ('why' in question) throw new Error(question.why)
    expect(question.reveal).toBe(`55 and older lean to ${pool[0].name} more.`)
  })
})

describe('names and numbers as a room reads them', () => {
  it('shortens book titles and series tags, not films', () => {
    expect(shortName('The Power of Now: A Guide to Spiritual Enlightenment', 'urn:entity:book')).toBe('The Power of Now')
    expect(shortName("Axiom's End (Noumena, #1)", 'urn:entity:book')).toBe("Axiom's End")
    expect(shortName('Synthetic Film: The Return', 'urn:entity:movie')).toBe('Synthetic Film: The Return')
    expect(townName('Glasgow, Scotland')).toBe('Glasgow')
    expect(townName('Halifax')).toBe('Halifax')
  })
  it('rounds ratings to tenths and drops a 1 January birth date', () => {
    expect(fields.businessRating({ properties: { business_rating: 4.300000190734863 } })).toBe(4.3)
    expect(fields.imdbRating({ external: { imdb: [{ user_rating: 7.199999 }] } })).toBe(7.2)
    expect(fields.birthDate({ properties: { date_of_birth: '1950-01-01' } })).toBeUndefined()
    expect(fields.birthDate({ properties: { date_of_birth: '1950-06-15' } })).toBe('1950-06-15')
  })
  it('never plans years past this one', () => {
    const plans = templatePlan({ town: 'Glasgow, Scotland', crowd: ['24_and_younger'], difficulty: 'hard', rounds: ['music', 'film', 'faces', 'local'] }, 2026)
    expect(plans[0].era?.to).toBe(2026)
  })
})
