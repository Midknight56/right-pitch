import { ROOM_MARGIN, YEAR_MARGIN } from '../limits'
import type { Level, Question, RecordRef } from './types'
import { BANDS } from './types'
import {
  birthDate,
  businessRating,
  imdbRating,
  neighborhood,
  popularity,
  publicationYear,
  releaseYear,
  startYear,
} from './fields'
import type { RawEntity } from '../qloo/client'

const readers: Record<string, (entity: RawEntity) => number | string | undefined> = {
  release_year: releaseYear,
  imdb_rating: imdbRating,
  publication_year: publicationYear,
  date_of_birth: birthDate,
  start_year: startYear,
  neighborhood,
  business_rating: businessRating,
  popularity,
}

export function verifyQuestion(
  question: Question,
  band: { min: number; max: number } | Level,
  used: Set<string>,
): string | null {
  const allowed = typeof band === 'string' ? BANDS[band] : band
  if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) {
    return 'Answer index out of range.'
  }
  const generation = question.template === 'generation_lean'
  // The room's own round: four options, each scored by the room's taste (query.affinity, 0 to 1).
  const roomPick = question.template === 'room_pick'
  if (question.options.length !== (generation ? 2 : 4)) return 'Wrong option count.'

  const records = generation
    ? [question.item]
    : question.options.map((option) => option.record)
  if (records.some((record) => !record)) return 'A field is missing on an option.'
  const validRecords = records as RecordRef[]
  for (const record of validRecords) {
    if (record.field === 'query.affinity' && generation) {
      if (!Number.isFinite(Number(question.item?.value)) || Number(question.item?.value) < 0
        || Number(question.item?.value) > 1) return 'A field is missing on an option.'
    } else if (roomPick) {
      const score = Number(record.value)
      if (record.field !== 'query.affinity' || typeof record.value !== 'number' || !Number.isFinite(score)
        || score < 0 || score > 1) return 'A field is missing on an option.'
    } else {
      const reader = readers[record.field]
      if (!reader || record.value === undefined) return 'A field is missing on an option.'
      if (record.field === 'date_of_birth' && !/^\d{4}-\d{2}-\d{2}$/.test(String(record.value))) {
        return 'A field is missing on an option.'
      }
      if (record.field === 'neighborhood' && typeof record.value !== 'string') {
        return 'A field is missing on an option.'
      }
      if (record.field !== 'date_of_birth' && record.field !== 'neighborhood'
        && !Number.isFinite(Number(record.value))) return 'A field is missing on an option.'
    }
    if (!Number.isFinite(record.popularity)
      || record.popularity < allowed.min - 1e-9 || record.popularity > allowed.max + 1e-9) {
      return 'An option is outside the popularity band.'
    }
  }
  const ids = validRecords.map((record) => record.qlooId)
  if (ids.some((id) => used.has(id)) || new Set(ids).size !== ids.length) return 'An id is used twice in the quiz.'

  if (generation) {
    if (!question.lens || !Number.isFinite(question.lens.young) || !Number.isFinite(question.lens.old)
      || question.lens.young < 0 || question.lens.young > 1 || question.lens.old < 0 || question.lens.old > 1
      || Math.abs(question.lens.young - question.lens.old) < 0.15) {
      return 'Affinity gap is under 0.15.'
    }
    return null
  }
  if (question.template === 'local_hood') {
    const neighborhoods = question.options.map((option) => option.record?.value)
    return new Set(neighborhoods).size === 4 ? null : 'Neighborhoods are not distinct.'
  }

  if (roomPick) {
    const scores = validRecords.map((record) => Number(record.value))
    if (scores[question.answer] !== Math.max(...scores)) return 'The marked answer is not the one the field picks.'
    const ranked = [...scores].sort((left, right) => right - left)
    return ranked[0] - ranked[1] >= ROOM_MARGIN - 1e-9 ? null : 'The answer margin is too small.'
  }

  const values = validRecords.map((record) => record.value)
  // The marked answer must be the one its field picks: the earliest year or birth date, or the highest rating.
  // The templates already rank by field; this check does not trust them.
  const highest = question.template === 'film_rating' || question.template === 'local_rating'
  const keys = values.map((value) => (question.template === 'faces_oldest' ? Date.parse(`${value}T00:00:00.000Z`) : Number(value)))
  const best = highest ? Math.max(...keys) : Math.min(...keys)
  if (keys[question.answer] !== best) return 'The marked answer is not the one the field picks.'
  const numbers = values.map(Number).sort((left, right) => left - right)
  let requiredMargin = YEAR_MARGIN
  if (question.template === 'film_rating') requiredMargin = 0.3
  if (question.template === 'local_rating') requiredMargin = 0.2
  const margin = question.template === 'film_rating' || question.template === 'local_rating'
    ? numbers[3] - numbers[2]
    : numbers[1] - numbers[0]
  if (question.template === 'faces_oldest') {
    const dates = values.map(String).sort()
    const gap = (Date.parse(`${dates[1]}T00:00:00.000Z`) - Date.parse(`${dates[0]}T00:00:00.000Z`))
      / (365.2425 * 24 * 60 * 60 * 1000)
    if (dates[0] === dates[1] || !Number.isFinite(gap) || gap < YEAR_MARGIN) {
      return 'The answer margin is too small.'
    }
  } else if (margin < requiredMargin) {
    return 'The answer margin is too small.'
  }
  return null
}
