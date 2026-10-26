import type { Setup } from './types'

// Each town carries its region: Qloo read plain "Glasgow" as Glasgow, Kentucky (live build, 25 Oct 2026).
export const PRESETS: { name: string; setup: Setup }[] = [
  { name: 'Tuesday, a Halifax pub, mostly 30 to 50', setup: { town: 'Halifax, Nova Scotia', crowd: ['30_to_34', '35_to_44', '45_to_54'], difficulty: 'mixed', rounds: ['film', 'music', 'generation', 'local'] } },
  { name: 'Toronto library night', setup: { town: 'Toronto, Ontario', crowd: ['30_to_34', '35_to_44'], difficulty: 'mixed', rounds: ['books', 'telly', 'faces', 'generation'] } },
  { name: 'London church hall, 55 and older', setup: { town: 'London, England', crowd: ['55_and_older'], difficulty: 'easy', rounds: ['film', 'telly', 'music', 'local'] } },
  { name: 'Vancouver school fundraiser, families', setup: { town: 'Vancouver, British Columbia', crowd: ['24_and_younger', '30_to_34', '35_to_44', '45_to_54'], difficulty: 'mixed', rounds: ['film', 'music', 'telly', 'generation'] } },
  { name: 'Glasgow students union, 24 and younger, hard', setup: { town: 'Glasgow, Scotland', crowd: ['24_and_younger'], difficulty: 'hard', rounds: ['music', 'film', 'faces', 'local'] } },
  { name: 'Sydney social club, mixed ages', setup: { town: 'Sydney, Australia', crowd: ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'], difficulty: 'mixed', rounds: ['telly', 'books', 'film', 'local'] } },
]
