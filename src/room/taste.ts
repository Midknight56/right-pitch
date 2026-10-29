// The room's own round. Players may type one favourite when they join; at Start the room asks Qloo what its taste leans
// to, and the last planned round makes way for "which of these fits this room best", with the favourites named on every
// reveal. Any failure plays the planned round: the room never waits on Qloo to be able to start.
import type { QlooClient, RawEntity } from '../qloo/client'
import { QUESTIONS_PER_ROUND, ROOM_FAVOURITES, ROOM_MARGIN, ROOM_MIN_QUESTIONS, ROOM_TOP_PICKS } from '../limits'
import { entityTypes, seededRandom } from '../quiz/build'
import { popularity } from '../quiz/fields'
import { fitForRoom, shortName } from '../quiz/fit'
import { nameKey, verifyQuestion } from '../quiz/verify'
import type { Question, Quiz, RecordRef, Round, RoundKind } from '../quiz/types'
import { favourites, type RoomState } from './game'

export interface Favourite { nick: string; text: string }
export interface RoomRoundResult { quiz: Quiz; built: boolean; why?: string }

/** Rounds whose 20 records are one Qloo type and can be scored against the room's taste. */
const MEDIA: RoundKind[] = ['film', 'telly', 'books', 'music', 'faces']
const TITLE = "The room's round"
const BANTER = 'Built from your favourites.'

interface Scored { record: RecordRef; affinity: number }

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** "Ann's Jaws, Bo's ABBA and Cy's Dune". */
function fromLine(seeds: { nick: string; name: string }[]): string {
  const parts = seeds.map((seed) => `${seed.nick}'s ${seed.name}`)
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

function scoredRecord(entity: RawEntity, type: string): Scored | null {
  const affinity = entity.query?.affinity
  const pop = popularity(entity)
  if (!entity.entity_id || !entity.name || !fitForRoom(entity.name) || typeof affinity !== 'number' || pop === undefined) {
    return null
  }
  const value = Math.round(affinity * 1000) / 1000
  return {
    affinity: value,
    record: { qlooId: entity.entity_id, name: shortName(entity.name, type), type, popularity: pop, field: 'query.affinity', value },
  }
}

export async function buildRoomRound(quiz: Quiz, given: Favourite[], qloo: QlooClient): Promise<RoomRoundResult> {
  const keep = (why: string): RoomRoundResult => ({ quiz, built: false, why })
  const wanted = given.slice(0, ROOM_FAVOURITES)
  if (!wanted.length) return keep('Nobody gave a favourite.')
  let index = -1
  quiz.rounds.forEach((round, i) => { if (MEDIA.includes(round.kind as RoundKind) && round.questions.length) index = i })
  if (index < 0) return keep('No round to make way.')
  const planned = quiz.rounds[index]!
  const type = entityTypes[planned.kind as RoundKind]
  const band = planned.meter.band
  const plannedRecords = planned.questions.flatMap((question) => question.options.flatMap((option) => option.record ? [option.record] : []))
  const quizIds = new Set(quiz.rounds.flatMap((round) => round.questions.flatMap((question) => [
    ...question.options.flatMap((option) => option.record ? [option.record.qlooId] : []),
    ...(question.item ? [question.item.qlooId] : []),
    ...question.options.flatMap((option) => option.record ? [nameKey(option.record.name)] : []),
    ...(question.item ? [nameKey(question.item.name)] : []),
  ])))

  try {
    const seeds: { nick: string; name: string; id: string }[] = []
    for (const favourite of wanted) {
      const found = (await qloo.search(favourite.text, undefined, 1)).results[0]
      if (!found?.entity_id || !found.name || !fitForRoom(found.name) || seeds.some((seed) => seed.id === found.entity_id)) continue
      seeds.push({ nick: favourite.nick, name: shortName(found.name, found.types?.[0] ?? ''), id: found.entity_id })
    }
    if (!seeds.length) return keep('No favourite was found on Qloo.')
    const signal = seeds.map((seed) => seed.id).join(',')

    // The room's own top picks in the planned round's type and band: the right answers.
    const top = await qloo.insights({
      'filter.type': `urn:entity:${type}`,
      'filter.popularity.min': String(band.min),
      'filter.popularity.max': String(band.max),
      'signal.interests.entities': signal,
      'filter.exclude.entities': [...seeds.map((seed) => seed.id), ...plannedRecords.map((record) => record.qlooId)].join(','),
      take: String(ROOM_TOP_PICKS),
    })
    const picks = top.results.map((entity) => scoredRecord(entity, type))
      .filter((pick): pick is Scored => !!pick && !quizIds.has(pick.record.qlooId)
        && !quizIds.has(nameKey(pick.record.name)) && !seeds.some((seed) => seed.id === pick.record.qlooId))
      .sort((left, right) => right.affinity - left.affinity)

    // The planned round's own items, scored against the same taste: the other options. Affinity is the same number
    // in every call, so the two lists compare (measured 28 Oct).
    const scored = await qloo.insights({
      'filter.type': `urn:entity:${type}`,
      'filter.results.entities': plannedRecords.map((record) => record.qlooId).join(','),
      'signal.interests.entities': signal,
      take: String(plannedRecords.length),
    })
    const byId = new Map(plannedRecords.map((record) => [record.qlooId, record]))
    const others = scored.results.flatMap((entity) => {
      const record = entity.entity_id ? byId.get(entity.entity_id) : undefined
      const affinity = entity.query?.affinity
      if (!record || typeof affinity !== 'number') return []
      const value = Math.round(affinity * 1000) / 1000
      return [{ affinity: value, record: { ...record, field: 'query.affinity', value } }]
    }).sort((left, right) => right.affinity - left.affinity)

    const rng = seededRandom(`${quiz.id}:room`)
    const from = fromLine(seeds)
    const used = new Set<string>()
    const questions: Question[] = []
    for (const pick of picks) {
      if (questions.length === QUESTIONS_PER_ROUND) break
      // The three closest options that still sit a fair margin under the answer.
      const rest = others.filter((other) => !used.has(other.record.qlooId) && other.affinity <= pick.affinity - ROOM_MARGIN).slice(0, 3)
      if (rest.length < 3) break
      const options = shuffle([pick, ...rest], rng)
      const question: Question = {
        id: `room_pick-${Math.floor(rng() * 1_000_000_000)}`,
        template: 'room_pick',
        prompt: "Which of these fits this room's taste best?",
        options: options.map((option) => ({ label: option.record.name, record: option.record })),
        answer: options.indexOf(pick),
        reveal: `${pick.record.name} fits this room best. From ${from}.`,
      }
      if (verifyQuestion(question, band, used)) continue
      questions.push(question)
      for (const option of options) {
        used.add(option.record.qlooId)
        used.add(nameKey(option.record.name))
      }
    }
    if (questions.length < ROOM_MIN_QUESTIONS) return keep(`Only ${questions.length} fair questions from the room's taste.`)

    const values = questions.flatMap((question) => question.options.map((option) => option.record!.popularity))
    const room: Round = {
      kind: 'room',
      level: planned.level,
      title: TITLE,
      banter: BANTER,
      meter: {
        band,
        mean: values.reduce((total, value) => total + value, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        n: values.length,
      },
      questions,
    }
    return { quiz: { ...quiz, rounds: [...quiz.rounds.filter((_, i) => i !== index), room] }, built: true }
  } catch (error) {
    return keep(error instanceof Error ? error.message : 'Qloo did not answer.')
  }
}

/** Once per room, before the first question: the room's round if it builds, the planned round if not. */
export async function startWithRoomRound(state: RoomState, qloo: QlooClient | null): Promise<RoomState> {
  if (state.phase !== 'lobby' || state.roomRound) return state
  const given = favourites(state)
  const result = qloo && given.length
    ? await buildRoomRound(state.quiz, given, qloo)
    : { quiz: state.quiz, built: false, why: given.length ? 'Live Qloo is off.' : 'Nobody gave a favourite.' }
  return { ...state, quiz: result.quiz, roomRound: { built: result.built, ...(result.why ? { why: result.why } : {}) } }
}
