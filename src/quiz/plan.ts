import type { Model, ToolSpec } from '../agent/model'
import { neuronsFor } from '../agent/model'
import type { Budget } from '../store/d1'
import { BANDS, DIFFICULTY_LEVELS, LEVELS } from './types'
import type { Level, Round, RoundPlan, Setup } from './types'

export interface PlannedRounds {
  plans: RoundPlan[]
  by: 'model' | 'template'
  neurons: number
}

export interface RoundName {
  title: string
}

export interface NamedRounds {
  names: RoundName[]
  by: 'model' | 'template'
  neurons: number
}

function ageBounds(age: Setup['crowd'][number]): [number, number] {
  if (age === '24_and_younger') return [0, 24]
  if (age === '55_and_older') return [55, 85]
  const [minimum, maximum] = age.split('_to_').map(Number)
  return [minimum, maximum]
}

export function templatePlan(setup: Setup, year: number): RoundPlan[] {
  const middleAge = [...setup.crowd].sort()[Math.floor((setup.crowd.length - 1) / 2)]
  const [youngest, oldest] = ageBounds(middleAge)
  // The years the middle of the crowd was 10 to 25, never past this year.
  const era = { from: year - oldest + 10, to: Math.min(year, year - youngest + 25) }
  return setup.rounds.map((kind, index) => {
    const level = DIFFICULTY_LEVELS[setup.difficulty][index]
    return {
      kind,
      level,
      band: { ...BANDS[level] },
      ...(['film', 'telly', 'music'].includes(kind) ? { era } : {}),
    }
  })
}

export function widen(plan: RoundPlan): RoundPlan {
  return {
    ...plan,
    band: { min: Math.max(0, plan.band.min - 0.05), max: Math.min(1, plan.band.max + 0.05) },
    ...(plan.era ? { era: { from: plan.era.from - 10, to: plan.era.to + 10 } } : {}),
  }
}

function planTool(setup: Setup): ToolSpec {
  return {
    type: 'function',
    function: {
      name: 'plan_rounds',
      description: 'Choose exactly the four requested round kinds and levels.',
      parameters: {
        type: 'object',
        properties: {
          rounds: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: setup.rounds },
                level: { type: 'string', enum: LEVELS },
                era: { type: 'object', properties: { from: { type: 'number' }, to: { type: 'number' } } },
              },
              required: ['kind', 'level'],
            },
          },
        },
        required: ['rounds'],
      },
    },
  }
}

function readToolArguments(reply: Awaited<ReturnType<Model['chat']>>, toolName: string): unknown {
  const call = reply.tool_calls.find((candidate) => candidate.function.name === toolName)
  return call ? JSON.parse(call.function.arguments) as unknown : undefined
}

export async function modelPlan(
  model: Model | null,
  setup: Setup,
  budget: Budget,
  year = new Date().getFullYear(),
): Promise<PlannedRounds> {
  const fallback = (): PlannedRounds => ({ plans: templatePlan(setup, year), by: 'template', neurons: 0 })
  if (!model) return fallback()
  const reservation = await budget.reserve()
  if (!reservation) return fallback()

  let reply: Awaited<ReturnType<Model['chat']>>
  try {
    reply = await model.chat([
      { role: 'system', content: 'Return round plans only. Never create question text or answers.' },
      { role: 'user', content: JSON.stringify({ setup, kinds: setup.rounds, levels: DIFFICULTY_LEVELS[setup.difficulty] }) },
    ], [planTool(setup)], 300)
  } catch {
    await reservation.settle(0)
    return fallback()
  }
  const cost = reply.neurons ?? neuronsFor(reply.prompt_tokens, reply.completion_tokens)
  await reservation.settle(cost)
  try {
    const raw = readToolArguments(reply, 'plan_rounds') as { rounds?: RoundPlan[] } | undefined
    if (!raw || !Array.isArray(raw.rounds) || raw.rounds.length !== 4) return { ...fallback(), neurons: cost }
    const valid = raw.rounds.every((plan, index) => {
      return plan.kind === setup.rounds[index] && LEVELS.includes(plan.level)
        && (!plan.era || Number.isFinite(plan.era.from) && Number.isFinite(plan.era.to) && plan.era.from <= plan.era.to)
    })
    if (!valid) return { ...fallback(), neurons: cost }
    // The model picks each round's level; the years come from the crowd's own ages when it gives none or gives
    // years outside the crowd's life (the first live build, 25 Oct, came back with no era at all).
    const crowd = templatePlan(setup, year)
    const plans = raw.rounds.map((plan, index) => {
      const fallbackEra = crowd[index].era
      const era = plan.era && fallbackEra && plan.era.from >= fallbackEra.from - 15 && plan.era.to <= year ? plan.era : fallbackEra
      return { kind: plan.kind, level: plan.level, band: { ...BANDS[plan.level as Level] }, ...(era ? { era } : {}) }
    })
    return { plans, by: 'model', neurons: cost }
  } catch {
    return { ...fallback(), neurons: cost }
  }
}

function nameTool(): ToolSpec {
  return {
    type: 'function',
    function: {
      name: 'name_rounds',
      description: 'Return four short round titles, one for each round, in order.',
      parameters: {
        type: 'object',
        properties: {
          rounds: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
          },
        },
        required: ['rounds'],
      },
    },
  }
}

function plainText(value: unknown, maxWords: number, maxChars: number): value is string {
  if (typeof value !== 'string' || value.length > maxChars) return false
  if ([...value].some((character) => [45, 8211, 8212].includes(character.charCodeAt(0)))) return false
  return value.trim().split(/\s+/).length <= maxWords
}

export async function modelNames(
  model: Model | null,
  budget: Budget,
  setup: Setup,
  rounds: Round[],
): Promise<NamedRounds> {
  const fallback = (): NamedRounds => ({ names: [], by: 'template', neurons: 0 })
  if (!model) return fallback()
  const reservation = await budget.reserve()
  if (!reservation) return fallback()
  let reply: Awaited<ReturnType<Model['chat']>>
  try {
    // The model sees what each round really holds, so a title cannot promise the 90s to a round of 2010s shows
    // (the first live builds did). It never sees a question's wording or its answer.
    const facts = rounds.map((round) => {
      const years = round.questions.flatMap((q) => q.options.flatMap((o) => typeof o.record?.value === 'number' && o.record.field.endsWith('year') ? [o.record.value] : []))
      return {
        kind: round.kind,
        level: round.level,
        ...(years.length ? { years: `${Math.min(...years)} to ${Math.max(...years)}` } : {}),
        examples: round.questions.slice(0, 3).map((q) => q.item?.name ?? q.options[0]?.label).filter(Boolean),
      }
    })
    reply = await model.chat([
      { role: 'system', content: 'You are a warm, playful pub quiz host. Give each round a title of 2 to 4 words that a room would smile at, like Popcorn Brains or Sofa Scholars. Use only the facts given: never name a decade, place or theme they do not show. No dashes, no digits. Do not write questions or answers.' },
      { role: 'user', content: JSON.stringify({ town: setup.town.split(',')[0], night: setup.night, rounds: facts }) },
    ], [nameTool()], 200)
  } catch {
    await reservation.settle(0)
    return fallback()
  }
  const cost = reply.neurons ?? neuronsFor(reply.prompt_tokens, reply.completion_tokens)
  await reservation.settle(cost)
  try {
    const raw = readToolArguments(reply, 'name_rounds') as { rounds?: RoundName[] } | undefined
    if (!raw || !Array.isArray(raw.rounds) || raw.rounds.length !== 4) return { ...fallback(), neurons: cost }
    if (!raw.rounds.every((name) => plainText(name.title, 4, 40) && !/\d/.test(name.title))) {
      return { ...fallback(), neurons: cost }
    }
    return { names: raw.rounds, by: 'model', neurons: cost }
  } catch {
    return { ...fallback(), neurons: cost }
  }
}
