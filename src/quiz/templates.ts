import { YEAR_MARGIN } from '../limits'
import { namesItsArea } from './fit'
import type { RawEntity } from '../qloo/client'
import type { Question, RecordRef } from './types'
import * as fields from './fields'

export interface TemplateContext {
  town?: string
  young?: Map<string, number>
  old?: Map<string, number>
}

export type TemplateResult = Question | { why: string }
type FieldReader = (entity: RawEntity) => number | string | undefined

function shuffle<T>(items: T[], rng: () => number): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}

function recordFor(entity: RawEntity, field: string, value: string | number): RecordRef | undefined {
  if (!entity.entity_id || !entity.name || fields.popularity(entity) === undefined) return undefined
  return {
    qlooId: entity.entity_id,
    name: entity.name,
    type: (entity.subtype ?? entity.types?.[0] ?? '').replace(/^urn:entity:/, ''),
    popularity: fields.popularity(entity)!,
    field,
    value,
  }
}

function* combinations<T>(items: T[], size: number): Generator<T[]> {
  function* visit(start: number, selected: T[]): Generator<T[]> {
    if (selected.length === size) {
      yield selected
      return
    }
    for (let index = start; index <= items.length - (size - selected.length); index++) {
      yield* visit(index + 1, [...selected, items[index]])
    }
  }
  yield* visit(0, [])
}

function comparableValue(value: number | string): number {
  // Normalize ISO dates to fractional years so the year margin matches other templates.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T00:00:00.000Z`) / (365.2425 * 24 * 60 * 60 * 1000)
  }
  return Number(value)
}

function makeNumericQuestion(
  pool: RawEntity[],
  rng: () => number,
  used: Set<string>,
  template: string,
  prompt: string,
  reader: FieldReader,
  field: string,
  direction: 'min' | 'max',
  margin: number,
  reveal: (entity: RawEntity, value: number | string) => string,
  _context: TemplateContext = {},
): TemplateResult {
  const available = pool.filter((entity) => {
    return entity.entity_id && !used.has(entity.entity_id) && reader(entity) !== undefined
      && fields.popularity(entity) !== undefined
  })
  const shuffled = shuffle(available, rng)
  for (const set of combinations(shuffled, 4)) {
    const ranked = [...set].sort((left, right) => {
      const difference = comparableValue(reader(left)!) - comparableValue(reader(right)!)
      return direction === 'min' ? difference : -difference
    })
    const best = comparableValue(reader(ranked[0])!)
    const next = comparableValue(reader(ranked[1])!)
    const gap = direction === 'min' ? next - best : best - next
    if (ranked[0] === ranked[1] || gap < margin) continue
    const records = new Map<string, RecordRef>()
    for (const entity of set) {
      const value = reader(entity)!
      const record = recordFor(entity, field, value)
      if (record) records.set(record.qlooId, record)
    }
    if (records.size !== 4) continue
    const options = shuffle(set, rng)
    const answer = options.indexOf(ranked[0])
    return {
      id: `${template}-${Math.floor(rng() * 1_000_000_000)}`,
      template,
      prompt,
      options: options.map((entity) => ({ label: entity.name!, record: records.get(entity.entity_id!)! })),
      answer,
      reveal: reveal(ranked[0], reader(ranked[0])!),
    }
  }
  return { why: `No four entities meet the ${margin} margin for ${field}.` }
}

function makeLocalNeighborhoodQuestion(
  pool: RawEntity[],
  rng: () => number,
  used: Set<string>,
  context: TemplateContext,
): TemplateResult {
  const places = pool.filter((entity) => entity.entity_id && !used.has(entity.entity_id)
    && fields.neighborhood(entity) && fields.popularity(entity) !== undefined)
  const byNeighborhood = new Map<string, RawEntity>()
  for (const place of shuffle(places, rng)) {
    const name = fields.neighborhood(place)!
    if (!byNeighborhood.has(name)) byNeighborhood.set(name, place)
  }
  if (byNeighborhood.size < 4) return { why: 'Fewer than four distinct neighborhoods.' }
  const options = shuffle([...byNeighborhood.entries()].slice(0, 4), rng)
  // The asked place must not carry any option's area in its own name.
  const town = context.town ?? ''
  const fair = options.flatMap(([, place], index) => {
    return options.some(([area]) => namesItsArea(place.name ?? '', area, town)) ? [] : [index]
  })
  if (!fair.length) return { why: 'Every place names its own area.' }
  const answer = fair[Math.floor(rng() * fair.length)]
  const target = options[answer]
  const item = target[1]
  const records = options.map(([name, place]) => recordFor(place, 'neighborhood', name))
  if (records.some((record) => !record)) return { why: 'A neighborhood option has no record.' }
  return {
    id: `local_hood-${Math.floor(rng() * 1_000_000_000)}`,
    template: 'local_hood',
    prompt: `${item.name} is in which part of ${context.town ?? 'town'}?`,
    options: options.map(([name], index) => ({ label: name, record: records[index]! })),
    answer,
    reveal: `${item.name} is in ${target[0]}.`,
  }
}

function makeGenerationQuestion(
  pool: RawEntity[],
  rng: () => number,
  used: Set<string>,
  context: TemplateContext,
): TemplateResult {
  const eligible = pool.filter((entity) => entity.entity_id && !used.has(entity.entity_id)
    && context.young?.has(entity.entity_id) && context.old?.has(entity.entity_id)
    && fields.popularity(entity) !== undefined)
  eligible.sort((left, right) => {
    const leftId = left.entity_id!
    const rightId = right.entity_id!
    const leftGap = Math.abs(context.young!.get(leftId)! - context.old!.get(leftId)!)
    const rightGap = Math.abs(context.young!.get(rightId)! - context.old!.get(rightId)!)
    return rightGap - leftGap
  })
  const entity = eligible[0]
  if (!entity?.entity_id) return { why: 'No entity has affinity under both age lenses.' }
  const eligibleId = entity.entity_id
  const eligibleEntity = entity
  const young = context.young!.get(eligibleId)!
  const old = context.old!.get(eligibleId)!
  if (Math.abs(young - old) < 0.15) return { why: 'Affinity gap is under 0.15.' }
  const item = recordFor(eligibleEntity, 'query.affinity', young > old ? young : old)
  if (!item) return { why: 'Generation entity has no record.' }
  const answer = young > old ? 0 : 1
  const age = answer === 0 ? '24 and younger' : '55 and older'
  return {
    id: `generation-${Math.floor(rng() * 1_000_000_000)}`,
    template: 'generation_lean',
    prompt: `Who leans to ${eligibleEntity.name} more: 24 and younger, or 55 and older?`,
    options: [{ label: '24 and younger' }, { label: '55 and older' }],
    answer,
    reveal: `${age[0].toUpperCase()}${age.slice(1)} lean to ${eligibleEntity.name} more.`,
    lens: { young, old },
    item,
  }
}

export const templates = {
  film_first: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'film_first', 'Which of these came out first?', fields.releaseYear,
    'release_year', 'min', YEAR_MARGIN, (entity, value) => `${entity.name} came out in ${value}.`, context,
  ),
  film_rating: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'film_rating', 'Which has the highest IMDb user rating?', fields.imdbRating,
    'imdb_rating', 'max', 0.3, (entity, value) => `${entity.name} has an IMDb user rating of ${value}.`, context,
  ),
  telly_first: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'telly_first', 'Which of these shows started first?', fields.releaseYear,
    'release_year', 'min', YEAR_MARGIN, (entity, value) => `${entity.name} started in ${value}.`, context,
  ),
  books_first: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'books_first', 'Which of these was published first?', fields.publicationYear,
    'publication_year', 'min', YEAR_MARGIN, (entity, value) => `${entity.name} was published in ${value}.`, context,
  ),
  faces_oldest: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'faces_oldest', 'Who was born first?', fields.birthDate,
    'date_of_birth', 'min', YEAR_MARGIN, (entity, value) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      const readableDate = new Intl.DateTimeFormat('en', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }).format(date)
      return `${entity.name} was born on ${readableDate}.`
    }, context,
  ),
  music_first: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'music_first', 'Which act started out first?', fields.startYear,
    'start_year', 'min', YEAR_MARGIN, (entity, value) => `${entity.name} started out in ${value}.`, context,
  ),
  generation_lean: makeGenerationQuestion,
  local_hood: makeLocalNeighborhoodQuestion,
  local_rating: (pool: RawEntity[], rng: () => number, used: Set<string>, context: TemplateContext) => makeNumericQuestion(
    pool, rng, used, 'local_rating', 'Which of these has the best rating?', fields.businessRating,
    'business_rating', 'max', 0.2, (entity, value) => `${entity.name} has a business rating of ${value}.`, context,
  ),
}

export type TemplateName = keyof typeof templates
