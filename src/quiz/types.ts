// The shapes shared by the builder, the room and the pages. docs/SPEC.md explains each one.

export const AGES = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'] as const
export type Age = (typeof AGES)[number]

export const ROUND_KINDS = ['film', 'telly', 'books', 'faces', 'music', 'generation', 'local'] as const
export type RoundKind = (typeof ROUND_KINDS)[number]

export const LEVELS = ['easy', 'medium', 'hard', 'deep'] as const
export type Level = (typeof LEVELS)[number]

/** Popularity percentile bands, inclusive. */
export const BANDS: Record<Level, { min: number; max: number }> = {
  easy: { min: 0.97, max: 1 },
  medium: { min: 0.9, max: 0.97 },
  hard: { min: 0.75, max: 0.9 },
  deep: { min: 0.5, max: 0.75 },
}

export type Difficulty = 'easy' | 'mixed' | 'hard'
export const DIFFICULTY_LEVELS: Record<Difficulty, Level[]> = {
  easy: ['easy', 'easy', 'medium', 'medium'],
  mixed: ['easy', 'medium', 'medium', 'hard'],
  hard: ['medium', 'hard', 'hard', 'deep'],
}

export interface Setup {
  town: string
  crowd: Age[]
  difficulty: Difficulty
  rounds: RoundKind[]
  seeds?: string[]
  night?: string
}

/** One round as planned, before any Qloo call. */
export interface RoundPlan {
  kind: RoundKind
  level: Level
  band: { min: number; max: number }
  /** Release or start years, for film, telly and music. */
  era?: { from: number; to: number }
  /** Qloo ids from the host's seeds, used as an extra taste signal. */
  seedIds?: string[]
}

/** A Qloo record behind an option, kept small: what the host taps to see. */
export interface RecordRef {
  qlooId: string
  name: string
  type: string
  popularity: number
  /** The field the question used, and its value: "release_year" 1994. */
  field: string
  value: string | number
}

export interface Option {
  label: string
  record?: RecordRef
}

export interface Question {
  id: string
  template: string
  prompt: string
  options: Option[]
  /** Index into options. */
  answer: number
  /** One line shown at the reveal: "Pulp Fiction came out in 1994." */
  reveal: string
  /** Entity being compared in a generation question. */
  item?: RecordRef
  /** The generation round: the item's affinity under each lens, 0 to 1. */
  lens?: { young: number; old: number }
}

export interface Meter {
  band: { min: number; max: number }
  mean: number
  min: number
  max: number
  n: number
}

/** A round of a quiz: a planned kind, or 'room', the last round a room builds from its players' favourites. */
export type QuizRoundKind = RoundKind | 'room'

export interface Round {
  kind: QuizRoundKind
  level: Level
  title: string
  banter: string
  meter: Meter
  questions: Question[]
}

export type BuildMode = 'live' | 'template' | 'cache' | 'replay' | 'off'

export interface Quiz {
  id: string
  createdAt: number
  mode: BuildMode
  setup: Setup
  rounds: Round[]
  /** Qloo calls this build made (0 for cache and replay). */
  qlooCalls: number
  neurons: number
}

/** What the phones see of a question: no answer, no records. */
export interface PublicQuestion {
  n: number
  of: number
  round: string
  /** The round kind, for the host screen's backdrop; empty when unknown. */
  kind: QuizRoundKind | ''
  prompt: string
  options: string[]
  endsAt: number
  /** The room's clock when it sent this. */
  now: number
}

export type BuildEvent =
  | { t: 'start'; mode: BuildMode; quiz: string }
  | { t: 'plan'; rounds: RoundPlan[]; by: 'model' | 'template' }
  | { t: 'call'; round: number; path: string; params: Record<string, string>; results: number; ms: number; cached: boolean }
  | { t: 'question'; round: number; index: number; ok: boolean; why?: string }
  | { t: 'replan'; round: number; why: string; plan: RoundPlan }
  | { t: 'round'; index: number; round: Round }
  | { t: 'usage'; qloo: number; neurons: number }
  | { t: 'done'; quiz: Quiz }
  | { t: 'error'; text: string }
