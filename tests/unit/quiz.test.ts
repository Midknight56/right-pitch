import { describe, expect, it } from 'vitest'
import type { Model } from '../../src/agent/model'
import type { BuildEvent } from '../../src/quiz/types'
import { buildQuiz } from '../../src/quiz/build'
import * as fields from '../../src/quiz/fields'
import { modelNames, modelPlan, templatePlan, widen } from '../../src/quiz/plan'
import { templates } from '../../src/quiz/templates'
import { nameKey, verifyQuestion } from '../../src/quiz/verify'
import type { Setup } from '../../src/quiz/types'
import { makeEntities, movies } from '../fixtures/entities'

const setup: Setup = {
  town: 'Halifax',
  crowd: ['30_to_34', '35_to_44', '45_to_54'],
  difficulty: 'mixed',
  rounds: ['film', 'music', 'generation', 'local'],
}

function rng(): () => number {
  let value = 10
  return () => {
    value = (value * 16807) % 2_147_483_647
    return value / 2_147_483_647
  }
}

describe('raw entity fields', () => {
  it('reads every supported field and returns undefined when it is absent', () => {
    const movie = movies[0]
    expect(fields.releaseYear(movie)).toBe(1990)
    expect(fields.imdbRating(movie)).toBe(6)
    expect(fields.publicationYear({ properties: { publication_year: '2001' } })).toBe(2001)
    expect(fields.birthDate({ properties: { date_of_birth: '1982-03-04' } })).toBe('1982-03-04')
    expect(fields.startYear({ properties: { start_year: 1985 } })).toBe(1985)
    expect(fields.neighborhood({ properties: { neighborhood: { name: 'North End' } } })).toBe('North End')
    expect(fields.neighborhood({ properties: { neighborhood: 'Downtown' } })).toBe('Downtown')
    expect(fields.businessRating({ properties: { business_rating: '4.6' } })).toBe(4.6)
    expect(fields.popularity(movie)).toBe(0.971)
    expect(fields.affinity(movie)).toBe(0.3)
    expect(fields.releaseYear({})).toBeUndefined()
    expect(fields.imdbRating({ external: { imdb: [] } })).toBeUndefined()
    expect(fields.birthDate({ properties: { date_of_birth: 'not a date' } })).toBeUndefined()
    expect(fields.birthDate({ properties: { date_of_birth: '2025-02-30' } })).toBeUndefined()
  })
})

describe('question templates', () => {
  const makePool = (kind: string, offset: number) => makeEntities(kind, offset, 0.98)

  it('builds each factual template and declines pools without enough records', () => {
    const factualCases = [
      ['film_first', makePool('movie', 100), {}],
      ['film_rating', makePool('movie', 200), {}],
      ['telly_first', makePool('tv_show', 300), {}],
      ['books_first', makePool('book', 400), {}],
      ['faces_oldest', makePool('person', 500), {}],
      ['music_first', makePool('artist', 600), {}],
      ['local_rating', makePool('place', 700), {}],
    ] as const
    for (const [name, pool, context] of factualCases) {
      const question = templates[name](pool, rng(), new Set(), context)
      expect('why' in question, name).toBe(false)
      expect(templates[name]([], rng(), new Set(), context), name).toHaveProperty('why')
    }

    const places = makePool('place', 800)
    const local = templates.local_hood(places, rng(), new Set(), { town: 'Halifax' })
    expect('why' in local).toBe(false)
    if (!('why' in local)) {
      expect(local.prompt).toMatch(/^place title \d+ is in which part of Halifax\?$/)
      expect(local.options.map((option) => option.label)).toHaveLength(4)
      expect(new Set(local.options.map((option) => option.label)).size).toBe(4)
      expect(local.options[local.answer].record?.value).toBe(local.reveal.split(' is in ')[1].replace('.', ''))
    }
    expect(templates.local_hood([], rng(), new Set(), { town: 'Halifax' })).toHaveProperty('why')
    expect(templates.generation_lean([], rng(), new Set(), {})).toHaveProperty('why')
  })

  it('includes the compared item and checks both age affinity lenses', () => {
    const pool = makePool('movie', 900)
    const young = new Map(pool.flatMap((entity, index) => entity.entity_id ? [[entity.entity_id, 0.7 + index / 100]] : []))
    const old = new Map(pool.flatMap((entity, index) => entity.entity_id ? [[entity.entity_id, 0.3 + index / 100]] : []))
    const question = templates.generation_lean(pool, rng(), new Set(), { young, old })
    expect('why' in question).toBe(false)
    if (!('why' in question)) {
      expect(question.item?.name).toMatch(/^movie title /)
      expect(question.prompt).toContain(`Who leans to ${question.item?.name} more:`)
      expect(question.options).toHaveLength(2)
      expect(question.lens).toBeDefined()
    }
    const narrow = new Map(pool.flatMap((entity) => entity.entity_id ? [[entity.entity_id, 0.61]] : []))
    expect(templates.generation_lean(pool, rng(), new Set(), { young: narrow, old: narrow })).toHaveProperty('why')
  })

  it('chooses options whose winner meets the required field margin', () => {
    const film = templates.film_rating(movies, rng(), new Set(), {})
    expect('why' in film).toBe(false)
    if (!('why' in film)) {
      const selected = film.options.map((option) => option.record!.value as number)
      expect(Math.max(...selected) - [...selected].sort((left, right) => right - left)[1]).toBeGreaterThanOrEqual(0.3)
    }
    const localPool = makeEntities('place', 1_100, 0.8)
    const rating = templates.local_rating(localPool, rng(), new Set(), {})
    expect('why' in rating).toBe(false)
    if (!('why' in rating)) {
      const sorted = rating.options.map((option) => Number(option.record!.value)).sort((left, right) => right - left)
      expect(sorted[0] - sorted[1]).toBeGreaterThanOrEqual(0.2)
      const close = {
        ...rating,
        options: rating.options.map((option) => ({ ...option, record: { ...option.record!, value: 4 } })),
      }
      expect(verifyQuestion(close, { min: 0.75, max: 0.9 }, new Set())).toMatch(/margin/)
    }
  })
})

describe('question verification', () => {
  it('refuses a new id when its name is already used, ignoring case and repeated spacing', () => {
    const base = templates.film_first(movies, rng(), new Set(), {})
    if ('why' in base) throw new Error(base.why)
    const duplicateName = {
      ...base,
      options: base.options.map((option, index) => index === 0
        ? { ...option, record: { ...option.record!, qlooId: 'different-id', name: 'Maisie  PETERS' } }
        : option),
    }
    expect(verifyQuestion(duplicateName, { min: 0.97, max: 1 }, new Set(['name:maisie peters'])))
      .toBe('A name is used twice in the quiz.')
  })

  it('rejects missing fields, ties, narrow margins, bands, repeated ids, counts and bad answers', () => {
    const base = templates.film_first(movies, rng(), new Set(), {})
    if ('why' in base) throw new Error(base.why)
    expect(verifyQuestion({ ...base, answer: 9 }, { min: 0.97, max: 1 }, new Set())).toMatch(/Answer/)
    expect(verifyQuestion({ ...base, options: base.options.slice(0, 3), answer: 0 }, { min: 0.97, max: 1 }, new Set())).toMatch(/count/)
    expect(verifyQuestion({ ...base, options: base.options.map((option, index) => index ? option : { label: option.label }) }, { min: 0.97, max: 1 }, new Set())).toMatch(/field/)
    expect(verifyQuestion(base, { min: 0.99, max: 1 }, new Set())).toMatch(/band/)
    // A marked answer that is not the earliest year fails, whatever the template said.
    expect(verifyQuestion(base, { min: 0.97, max: 1 }, new Set())).toBeNull()
    expect(verifyQuestion({ ...base, answer: (base.answer + 1) % 4 }, { min: 0.97, max: 1 }, new Set())).toMatch(/field picks/)
    const top = templates.film_rating(movies, rng(), new Set(), {})
    if ('why' in top) throw new Error(top.why)
    expect(verifyQuestion({ ...top, answer: (top.answer + 1) % 4 }, { min: 0.97, max: 1 }, new Set())).toMatch(/field picks/)
    expect(verifyQuestion(base, { min: 0.97, max: 1 }, new Set([base.options[0].record!.qlooId]))).toMatch(/twice/)

    const tied = {
      ...base,
      options: base.options.map((option) => ({ ...option, record: { ...option.record!, value: 1990 } })),
    }
    expect(verifyQuestion(tied, { min: 0.97, max: 1 }, new Set())).toMatch(/margin/)
  })

  it('rejects close generation affinity and repeated local neighborhoods', () => {
    const generation = templates.generation_lean(movies, rng(), new Set(), {
      young: new Map(movies.map((entity) => [entity.entity_id!, 0.8])),
      old: new Map(movies.map((entity) => [entity.entity_id!, 0.4])),
    })
    if ('why' in generation) throw new Error(generation.why)
    expect(verifyQuestion({ ...generation, lens: { young: 0.6, old: 0.5 } }, { min: 0.97, max: 1 }, new Set())).toMatch(/Affinity gap/)

    const local = templates.local_hood(makeEntities('place', 1000, 0.98), rng(), new Set(), { town: 'Halifax' })
    if ('why' in local) throw new Error(local.why)
    const duplicateNeighborhoods = {
      ...local,
      options: local.options.map((option) => ({ ...option, record: { ...option.record!, value: 'Same place' } })),
    }
    expect(verifyQuestion(duplicateNeighborhoods, { min: 0.97, max: 1 }, new Set())).toMatch(/Neighborhoods/)
  })

  it('enforces the year, IMDb and business rating gaps', () => {
    const yearQuestion = templates.film_first(movies, rng(), new Set(), {})
    if ('why' in yearQuestion) throw new Error(yearQuestion.why)
    const closeYears = {
      ...yearQuestion,
      answer: 0,
      options: yearQuestion.options.map((option, index) => ({
        ...option,
        record: { ...option.record!, value: index < 2 ? 1990 : 1995 + index },
      })),
    }
    expect(verifyQuestion(closeYears, { min: 0.97, max: 1 }, new Set())).toMatch(/margin/)
    // Two years apart is still too close for a room.
    const twoYears = { ...closeYears, options: closeYears.options.map((option, index) => ({ ...option, record: { ...option.record, value: [1990, 1992, 1997, 1999][index] } })) }
    expect(verifyQuestion(twoYears, { min: 0.97, max: 1 }, new Set())).toMatch(/margin/)
    expect(verifyQuestion({ ...twoYears, options: twoYears.options.map((option, index) => ({ ...option, record: { ...option.record, value: [1990, 1993, 1997, 1999][index] } })) }, { min: 0.97, max: 1 }, new Set())).toBeNull()

    const imdbQuestion = templates.film_rating(movies, rng(), new Set(), {})
    if ('why' in imdbQuestion) throw new Error(imdbQuestion.why)
    const closeImdb = {
      ...imdbQuestion,
      answer: 3,
      options: imdbQuestion.options.map((option, index) => ({
        ...option,
        record: { ...option.record!, value: index < 2 ? 6 : 6 + index * 0.1 },
      })),
    }
    expect(verifyQuestion(closeImdb, { min: 0.97, max: 1 }, new Set())).toMatch(/margin/)

    const businessQuestion = templates.local_rating(makeEntities('place', 1_200, 0.8), rng(), new Set(), {})
    if ('why' in businessQuestion) throw new Error(businessQuestion.why)
    const closeBusiness = {
      ...businessQuestion,
      options: businessQuestion.options.map((option) => ({
        ...option,
        record: { ...option.record!, value: 4 },
      })),
    }
    const dateQuestion = templates.faces_oldest(makeEntities('person', 1_300, 0.8), rng(), new Set(), {})
    expect('why' in dateQuestion).toBe(false)
    if (!('why' in dateQuestion)) {
      const dates = dateQuestion.options.map((option) => Date.parse(`${option.record!.value}T00:00:00.000Z`))
      const ordered = [...dates].sort((left, right) => left - right)
      expect((ordered[1] - ordered[0]) / (365.2425 * 24 * 60 * 60 * 1000)).toBeGreaterThanOrEqual(1)
      expect(dateQuestion.reveal).not.toContain('-')
    }
    expect(verifyQuestion(closeBusiness, { min: 0.75, max: 0.9 }, new Set())).toMatch(/margin/)
  })
})

describe('round planning', () => {
  it('plans difficulty bands and crowd eras, then widens and drops the era', () => {
    const plans = templatePlan(setup, 2026)
    expect(plans).toHaveLength(4)
    expect(plans[0].era).toEqual({ from: 1992, to: 2016 })
    const replan = widen(plans[0])
    expect(replan.band.min).toBeCloseTo(0.92)
    expect(replan.era?.from).toBe(1982)
    expect({ ...replan, era: undefined }.era).toBeUndefined()
  })

  it('uses a model tool only after reserving and settles its actual neuron cost', async () => {
    const calls: unknown[] = []
    const model: Model = {
      name: 'fixture-model',
      chat: async (messages, tools) => {
        calls.push({ messages, tools })
        return {
          content: '', prompt_tokens: 10, completion_tokens: 10, neurons: 2,
          tool_calls: [{ id: 'plan', type: 'function', function: { name: 'plan_rounds', arguments: JSON.stringify({
            rounds: setup.rounds.map((kind, index) => ({ kind, level: ['easy', 'medium', 'medium', 'hard'][index] })),
          }) } }],
        }
      },
    }
    const settled: number[] = []
    const planned = await modelPlan(model, setup, {
      reserve: async () => ({ settle: async (neurons) => { settled.push(neurons) } }),
    }, 2026)
    expect(planned.by).toBe('model')
    // The model gave no years, so film and music take the crowd's own years.
    expect(planned.plans[0].era).toEqual(templatePlan(setup, 2026)[0].era)
    expect(planned.plans[0].era).toBeDefined()
    expect(planned.neurons).toBe(2)
    expect(settled).toEqual([2])
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls)).not.toContain('Which of these')
  })

  it('uses template names when the neuron budget refuses a reservation', async () => {
    const refused: Model = { name: 'none', chat: async () => { throw new Error('must not call') } }
    const budget = { reserve: async () => null }
    expect((await modelPlan(refused, setup, budget, 2026)).by).toBe('template')
    expect((await modelNames(refused, budget, setup, [])).by).toBe('template')
  })

  it('uses a separate name tool without sharing question text and settles its reservation', async () => {
    const seen: string[] = []
    const model: Model = {
      name: 'fixture-model',
      chat: async (messages, tools) => {
        seen.push(JSON.stringify({ messages, tools }))
        return {
          content: '', prompt_tokens: 1, completion_tokens: 1, neurons: 1,
          tool_calls: [{ id: 'names', type: 'function', function: {
            name: 'name_rounds',
            arguments: JSON.stringify({ rounds: setup.rounds.map(() => ({ title: 'Local Favorites' })) }),
          } }],
        }
      },
    }
    const settled: number[] = []
    const result = await modelNames(model, {
      reserve: async () => ({ settle: async (neurons) => { settled.push(neurons) } }),
    }, setup, [])
    expect(result.by).toBe('model')
    expect(result.names).toHaveLength(4)
    expect(settled).toEqual([1])
    expect(seen[0]).toContain('name_rounds')
    expect(seen[0]).not.toContain('Which of these came out first?')
  })

  it('refuses titles with digits or dashes and gives the model the years each round holds', async () => {
    const seen: string[] = []
    const titles = ['Nineties Night', '90s Telly', 'Books', 'Faces']
    const model: Model = {
      name: 'fixture-model',
      chat: async (messages) => {
        seen.push(JSON.stringify(messages))
        return { content: '', prompt_tokens: 1, completion_tokens: 1, neurons: 1, tool_calls: [{ id: 'n', type: 'function', function: { name: 'name_rounds', arguments: JSON.stringify({ rounds: titles.map((title) => ({ title })) }) } }] }
      },
    }
    const film = templates.film_first(movies, rng(), new Set(), {})
    if ('why' in film) throw new Error(film.why)
    const round = { kind: 'film' as const, level: 'easy' as const, title: '', banter: '', meter: { band: { min: 0.97, max: 1 }, mean: 0.98, min: 0.97, max: 0.99, n: 4 }, questions: [film] }
    const result = await modelNames(model, { reserve: async () => ({ settle: async () => undefined }) }, setup, [round, round, round, round])
    expect(result.by).toBe('template')
    const years = film.options.map((option) => Number(option.record!.value))
    expect(seen[0]).toContain(`${Math.min(...years)} to ${Math.max(...years)}`)
  })
})

describe('build loop', () => {
  it('does not repeat a name across music and faces when Qloo uses different ids', async () => {
    const artists = makeEntities('artist', 3100, 0.98).map((entity, index) => ({
      ...entity,
      name: index === 0 ? 'Maisie Peters' : entity.name,
      properties: { ...entity.properties, start_year: 2012 + index },
    }))
    const people = makeEntities('person', 3200, 0.98).map((entity, index) => ({
      ...entity,
      name: index === 0 ? 'Maisie  PETERS' : entity.name,
      properties: { ...entity.properties, date_of_birth: `${String(1940 + index).padStart(4, '0')}-06-15` },
    }))
    const qloo = {
      insights: async (params: Record<string, string>) => ({
        results: params['filter.results.entities'] ? [] : params['filter.type'] === 'urn:entity:artist' ? artists : people,
        cached: false,
        ms: 1,
      }),
      search: async () => ({ results: [], cached: false, ms: 1 }),
    }
    const quiz = await buildQuiz({ ...setup, crowd: ['24_and_younger'], rounds: ['music', 'faces', 'generation', 'local'] }, {
      qloo: qloo as never,
      budget: { reserve: async () => null },
      id: 'same-name-across-rounds',
      year: 2026,
    }, () => undefined)
    const names = quiz.rounds.flatMap((round) => round.questions.flatMap((question) => [
      ...question.options.flatMap((option) => option.record ? [nameKey(option.record.name)] : []),
      ...(question.item ? [nameKey(question.item.name)] : []),
    ]))
    expect(names.filter((name) => name === nameKey('Maisie Peters'))).toHaveLength(1)
    expect(new Set(names).size).toBe(names.length)
  })

  it('builds four five-question rounds without repeating an entity', async () => {
    const pools = new Map<string, ReturnType<typeof makeEntities>>([
      ['movie', makeEntities('movie', 2000, 0.98)],
      ['artist', makeEntities('artist', 2100, 0.95)],
      ['place', makeEntities('place', 2200, 0.8)],
    ])
    const allEntities = [...pools.values()].flat()
    let calls = 0
    const queryLog: Record<string, string>[] = []
    const searched: string[] = []
    const qloo = {
      insights: async (params: Record<string, string>) => {
        calls++
        queryLog.push(params)
        if (params['filter.results.entities']) {
          const entities = allEntities.filter((entity) => params['filter.results.entities'].split(',').includes(entity.entity_id!))
          return {
            results: entities.map((entity, index) => ({
              ...entity,
              query: { affinity: params['signal.demographics.age'] === '24_and_younger' ? 0.8 : 0.4 + index / 100 },
            })),
            cached: false,
            ms: 1,
          }
        }
        const type = params['filter.type'].replace('urn:entity:', '')
        const results = pools.get(type) ?? []
        return { results, cached: false, ms: 1 }
      },
      search: async (query: string) => {
        calls++
        searched.push(query)
        return { results: [{ entity_id: 'synthetic-seed' }], cached: false, ms: 1 }
      },
    }
    const events: BuildEvent[] = []
    const quiz = await buildQuiz({ ...setup, seeds: ['Harbour Lights', 'The Quiet Year'] }, {
      qloo: qloo as never,
      budget: { reserve: async () => null },
      id: 'invented-seed',
      year: 2026,
      history: Array.from({ length: 45 }, (_, index) => `history-${index}`),
    }, (event) => { events.push(event) })
    expect(quiz.rounds).toHaveLength(4)
    expect(quiz.mode).toBe('template')
    expect(quiz.rounds.map((round) => [round.kind, round.questions.length])).toEqual([
      ['film', 5], ['music', 5], ['generation', 5], ['local', 5],
    ])
    const ids = quiz.rounds.flatMap((round) => round.questions.flatMap((question) => [
      ...question.options.flatMap((option) => option.record ? [option.record.qlooId] : []),
      ...(question.item ? [question.item.qlooId] : []),
    ]))
    expect(new Set(ids).size).toBe(ids.length)
    expect(events[0].t).toBe('start')
    expect(events[1].t).toBe('plan')
    expect(events.at(-1)?.t).toBe('done')
    const roundEvents = events.filter((event): event is Extract<BuildEvent, { t: 'round' }> => event.t === 'round')
    expect(roundEvents).toHaveLength(4)
    expect(roundEvents.map((event) => event.index)).toEqual([0, 1, 2, 3])
    expect(events.filter((event) => event.t === 'question').length).toBeGreaterThanOrEqual(20)
    expect(events.findIndex((event) => event.t === 'usage')).toBeLessThan(events.findIndex((event) => event.t === 'done'))
    expect(quiz.qlooCalls).toBe(calls)
    expect(searched).toEqual(['Harbour Lights', 'The Quiet Year'])
    expect(queryLog[0]['filter.exclude.entities'].split(',')).toHaveLength(40)
    expect(queryLog[0]['signal.location.query']).toBe('Halifax')
    // The age lens asks with the age signal alone: a town or seed signal pulls both lenses the same way.
    const lens = queryLog.filter((params) => params['filter.results.entities'])
    expect(new Set(lens.map((params) => params['signal.demographics.age']))).toEqual(new Set(['24_and_younger', '55_and_older']))
    for (const params of lens) {
      expect(params['signal.location.query']).toBeUndefined()
      expect(params['signal.interests.entities']).toBeUndefined()
      expect(params['filter.results.entities'].split(',').length).toBeLessThanOrEqual(20)
    }
    expect(queryLog[0]['filter.release_year.min']).toBe('1992')
    expect(queryLog.find((params) => params['filter.type'] === 'urn:entity:place')?.['filter.location.query']).toBe('Halifax')
    expect(queryLog[0]['signal.interests.entities']).toBe('synthetic-seed')
    expect(queryLog.find((params) => params['filter.type'] === 'urn:entity:place')?.['signal.interests.entities']).toBeUndefined()
  })

  it('stops at 16 upstream calls when every round keeps failing verification', async () => {
    let calls = 0
    const qloo = {
      insights: async () => {
        calls++
        return { results: [], cached: false, ms: 1 }
      },
      search: async () => ({ results: [], cached: false, ms: 1 }),
    }
    const quiz = await buildQuiz(setup, {
      qloo: qloo as never,
      budget: { reserve: async () => null },
      id: 'all-empty',
      year: 2026,
    }, () => undefined)
    expect(calls).toBe(16)
    expect(quiz.qlooCalls).toBe(16)
  })

  it('does not count cached Qloo answers toward the upstream call cap', async () => {
    let queries = 0
    const qloo = {
      insights: async () => {
        queries++
        return { results: [], cached: true, ms: 0 }
      },
      search: async () => ({ results: [], cached: true, ms: 0 }),
    }
    const quiz = await buildQuiz(setup, {
      qloo: qloo as never,
      budget: { reserve: async () => null },
      id: 'cached-empty',
      year: 2026,
    }, () => undefined)
    expect(queries).toBeGreaterThan(16)
    expect(quiz.qlooCalls).toBe(0)
  })
})
