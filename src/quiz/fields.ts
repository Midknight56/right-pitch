import type { RawEntity } from '../qloo/client'

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function releaseYear(entity: RawEntity): number | undefined {
  return numericValue(objectValue(entity.properties)?.release_year)
}

/** One decimal place, as a room reads a rating: Qloo stores 4.3 as 4.300000190734863. */
function tenths(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 10) / 10
}

export function imdbRating(entity: RawEntity): number | undefined {
  const imdb = objectValue(entity.external)?.imdb
  const first = Array.isArray(imdb) ? objectValue(imdb[0]) : undefined
  return tenths(numericValue(first?.user_rating))
}

export function publicationYear(entity: RawEntity): number | undefined {
  return numericValue(objectValue(entity.properties)?.publication_year)
}

export function birthDate(entity: RawEntity): string | undefined {
  const value = objectValue(entity.properties)?.date_of_birth
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  // 1 January stands in for an unknown day (the first live builds had a singer "born on January 1, 1950").
  if (value.endsWith('-01-01')) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value
}

export function startYear(entity: RawEntity): number | undefined {
  return numericValue(objectValue(entity.properties)?.start_year)
}

export function neighborhood(entity: RawEntity): string | undefined {
  const value = objectValue(entity.properties)?.neighborhood
  if (typeof value === 'string') return value || undefined
  const name = objectValue(value)?.name
  return typeof name === 'string' && name ? name : undefined
}

export function businessRating(entity: RawEntity): number | undefined {
  return tenths(numericValue(objectValue(entity.properties)?.business_rating))
}

export function popularity(entity: RawEntity): number | undefined {
  return numericValue(entity.popularity)
}

export function affinity(entity: RawEntity): number | undefined {
  return numericValue(entity.query?.affinity)
}
