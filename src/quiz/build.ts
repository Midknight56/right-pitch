import type { Model } from '../agent/model'
import type { Budget } from '../store/d1'
import { QlooClient } from '../qloo/client'
import type { RawEntity } from '../qloo/client'
import { LENS_ITEMS, QUESTIONS_PER_ROUND } from '../limits'
import { startYear } from './fields'
import { modelNames, modelPlan, widen } from './plan'
import { templates } from './templates'
import { verifyQuestion } from './verify'
import { fitForRoom, shortName, townName } from './fit'
import { canMakeQlooCall } from '../app/caps'
import type { BuildEvent, BuildMode, Question, Quiz, Round, RoundKind, RoundPlan, Setup } from './types'

export interface BuildDeps {
  qloo: QlooClient
  model?: Model | null
  budget: Budget
  history?: string[]
  id?: string
  now?: number
  year?: number
}

type Sender = (event: BuildEvent) => void | Promise<void>
// The house words for each round: the titles when the model is off, and the one line under every title. Fixed lines,
// so nothing on screen claims what the round does not hold. The same lines the host voice says.
const TITLES: Record<RoundKind, string> = {
  film: 'Film', telly: 'Telly', books: 'Books', faces: 'Famous faces', music: 'Music', generation: 'The generation game', local: 'The local round',
}
const BANTER: Record<RoundKind, string> = {
  film: 'Get your popcorn brains on.', telly: 'Sofa knowledge counts.', books: 'Shelf of fame time.', faces: 'Who came first?',
  music: 'Hum it if you have to.', generation: 'Young or old, who leans to it?', local: 'Home advantage.',
}
const entityTypes: Record<RoundKind, string> = {
  film: 'movie', telly: 'tv_show', books: 'book', faces: 'person', music: 'artist',
  generation: 'movie', local: 'place',
}
const roundTemplates: Record<RoundKind, (keyof typeof templates)[]> = {
  film: ['film_first', 'film_rating'], telly: ['telly_first'], books: ['books_first'],
  faces: ['faces_oldest'], music: ['music_first'], generation: ['generation_lean'],
  local: ['local_hood', 'local_rating'],
}

function seededRandom(seed: string): () => number {
  let state = 0
  for (const character of seed) state = (Math.imul(state, 31) + character.charCodeAt(0)) | 0
  return () => {
    state |= 0
    state = (state + 0x6D2B79F5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function queryParams(setup: Setup, plan: RoundPlan, history: string[], seedIds: string[]): Record<string, string> {
  const params: Record<string, string> = {
    'filter.type': `urn:entity:${entityTypes[plan.kind]}`,
    'filter.popularity.min': String(plan.band.min),
    'filter.popularity.max': String(plan.band.max),
    'signal.demographics.age': setup.crowd.join(','),
    take: '50',
  }
  if (plan.kind === 'local') params['filter.location.query'] = setup.town
  else params['signal.location.query'] = setup.town
  if (history.length) params['filter.exclude.entities'] = history.slice(0, 40).join(',')
  if (seedIds.length && plan.kind !== 'local') params['signal.interests.entities'] = seedIds.join(',')
  if (plan.era && ['film', 'telly'].includes(plan.kind)) {
    params['filter.release_year.min'] = String(plan.era.from)
    params['filter.release_year.max'] = String(plan.era.to)
  }
  if (plan.era && plan.kind === 'books') {
    params['filter.publication_year.min'] = String(plan.era.from)
    params['filter.publication_year.max'] = String(plan.era.to)
  }
  if (plan.era && plan.kind === 'faces') {
    params['filter.date_of_birth.min'] = `${plan.era.from}-01-01`
    params['filter.date_of_birth.max'] = `${plan.era.to}-12-31`
  }
  return params
}

function roundMeter(questions: Question[], band: RoundPlan['band']) {
  const values = questions.flatMap((question) => question.options.flatMap((option) => {
    return option.record ? [option.record.popularity] : question.item ? [question.item.popularity] : []
  }))
  return {
    band,
    mean: values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    n: values.length,
  }
}

async function fetchPool(
  client: QlooClient,
  params: Record<string, string>,
  round: number,
  calls: { value: number },
  send: Sender,
): Promise<RawEntity[]> {
  if (!canMakeQlooCall(calls.value)) return []
  const answer = await client.insights(params)
  if (!answer.cached) calls.value++
  // Names not fit for a room's big screen never reach a question.
  answer.results = answer.results.filter((entity) => fitForRoom(entity.name))
    .map((entity) => ({ ...entity, name: shortName(entity.name!, entity.types?.[0] ?? params['filter.type']) }))
  await send({
    t: 'call', round, path: '/v2/insights', params,
    results: answer.results.length, ms: answer.ms, cached: answer.cached,
  })
  return answer.results
}

async function generationLenses(
  client: QlooClient,
  params: Record<string, string>,
  pool: RawEntity[],
  round: number,
  calls: { value: number },
  send: Sender,
): Promise<{ young: Map<string, number>; old: Map<string, number> }> {
  const young = new Map<string, number>()
  const old = new Map<string, number>()
  const ids = pool.slice(0, LENS_ITEMS).flatMap((entity) => entity.entity_id ? [entity.entity_id] : [])
  for (const age of ['24_and_younger', '55_and_older']) {
    if (!canMakeQlooCall(calls.value)) break
    // The age signal alone, as in the kill test: a town or seed signal pulls both lenses the same way and the gap
    // vanishes (the first live build, 25 Oct: 0 of 15 items cleared 0.15 with the town signal on).
    const query = {
      'filter.type': params['filter.type'],
      'filter.results.entities': ids.join(','),
      'signal.demographics.age': age,
      take: String(ids.length),
    }
    const results = await fetchPool(client, query, round, calls, send)
    const target = age === '24_and_younger' ? young : old
    // Insights defaults to popularity order, so rank the age lens by affinity here.
    const rankedResults = [...results].sort((left, right) => {
      return (right.query?.affinity ?? 0) - (left.query?.affinity ?? 0)
    })
    for (const entity of rankedResults) {
      const affinity = entity.query?.affinity
      if (entity.entity_id && typeof affinity === 'number') target.set(entity.entity_id, affinity)
    }
  }
  return { young, old }
}

export async function buildQuiz(setup: Setup, deps: BuildDeps, send: Sender): Promise<Quiz> {
  const id = deps.id ?? crypto.randomUUID()
  const rng = seededRandom(id)
  const planned = await modelPlan(deps.model ?? null, setup, deps.budget, deps.year)
  const plans = planned.plans
  const used = new Set<string>()
  const calls = { value: 0 }
  let neurons = planned.neurons
  const mode: BuildMode = planned.by === 'model' ? 'live' : 'template'
  const emit = (event: BuildEvent) => send(event)

  await emit({ t: 'start', mode, quiz: id })
  await emit({ t: 'plan', rounds: plans, by: planned.by })
  const seedIds: string[] = []
  for (const seed of (setup.seeds ?? []).slice(0, 3)) {
    if (!canMakeQlooCall(calls.value)) break
    const result = await deps.qloo.search(seed, undefined, 5)
    if (!result.cached) calls.value++
    await emit({
      t: 'call', round: 0, path: '/search',
      params: { query: seed, take: '5' }, results: result.results.length,
      ms: result.ms, cached: result.cached,
    })
    const seedId = result.results[0]?.entity_id
    if (seedId && !seedIds.includes(seedId)) seedIds.push(seedId)
  }

  const rounds: Round[] = []
  for (let roundIndex = 0; roundIndex < plans.length; roundIndex++) {
    let plan = plans[roundIndex]
    const kind = plan.kind
    let accepted: Question[] = []
    for (let attempt = 0; attempt <= 2; attempt++) {
      const params = queryParams(setup, plan, deps.history ?? [], seedIds)
      let pool = await fetchPool(deps.qloo, params, roundIndex, calls, send)
      if (kind === 'music' && plan.era) {
        pool = pool.filter((entity) => {
          const year = startYear(entity)
          return year !== undefined && year >= plan.era!.from && year <= plan.era!.to
        })
      }
      const lensPool = kind === 'generation'
        ? pool.filter((entity) => !entity.entity_id || !used.has(entity.entity_id))
        : pool
      const lenses = kind === 'generation'
        ? await generationLenses(deps.qloo, params, lensPool, roundIndex, calls, send)
        : { young: new Map<string, number>(), old: new Map<string, number>() }
      const localUsed = new Set(used)
      const questions: Question[] = []
      for (let questionIndex = 0; questionIndex < QUESTIONS_PER_ROUND; questionIndex++) {
        let question: Question | undefined
        let reason = 'No verified question could be filled.'
        for (const templateName of roundTemplates[kind]) {
          const candidate = templates[templateName](pool, rng, localUsed, {
            town: townName(setup.town), young: lenses.young, old: lenses.old,
          })
          if ('why' in candidate) {
            reason = candidate.why
            continue
          }
          const problem = verifyQuestion(candidate, plan.band, localUsed)
          if (problem) {
            reason = problem
            continue
          }
          question = candidate
          break
        }
        if (question) {
          questions.push(question)
          for (const option of question.options) if (option.record) localUsed.add(option.record.qlooId)
          if (question.item) localUsed.add(question.item.qlooId)
          await emit({ t: 'question', round: roundIndex, index: questionIndex, ok: true })
        } else {
          await emit({ t: 'question', round: roundIndex, index: questionIndex, ok: false, why: reason })
        }
      }
      if (questions.length === QUESTIONS_PER_ROUND || !canMakeQlooCall(calls.value) || attempt === 2) {
        accepted = questions
        for (const question of accepted) {
          for (const option of question.options) if (option.record) used.add(option.record.qlooId)
          if (question.item) used.add(question.item.qlooId)
        }
        break
      }
      // The last retry drops the year filter after the widened era also came up short.
      plan = attempt === 1 ? { ...plan, era: undefined } : widen(plan)
      await emit({ t: 'replan', round: roundIndex, why: `${questions.length} of 5 questions verified.`, plan })
    }
    const round: Round = {
      kind,
      level: plan.level,
      title: TITLES[kind],
      banter: '',
      meter: roundMeter(accepted, plan.band),
      questions: accepted,
    }
    rounds.push(round)
    await emit({ t: 'round', index: roundIndex, round })
  }

  const names = await modelNames(deps.model ?? null, deps.budget, setup, rounds)
  neurons += names.neurons
  rounds.forEach((round, index) => {
    round.title = names.names[index]?.title ?? TITLES[round.kind]
    round.banter = BANTER[round.kind]
  })
  const finalMode: BuildMode = planned.by === 'template' || names.by === 'template' ? 'template' : 'live'
  const quiz: Quiz = {
    id,
    createdAt: deps.now ?? Date.now(),
    mode: finalMode,
    setup,
    rounds,
    qlooCalls: calls.value,
    neurons,
  }
  await emit({ t: 'usage', qloo: calls.value, neurons })
  await emit({ t: 'done', quiz })
  return quiz
}
