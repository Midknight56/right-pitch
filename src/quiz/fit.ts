// What may go on a pub's big screen. Qloo names are real names, and a few are not fit to read out to a room.

// Substrings that are never fine, and whole words that are rude only on their own ("grape" stays, "rape" goes).
const ANYWHERE = /fuck|shit|cunt|nigg|whore|slut|porn|motherf/i
const WORDS = /\b(dick|cock|pussy|rape|bitch|fag|twat|wank)\b/i

export function fitForRoom(name: string | undefined): boolean {
  return Boolean(name) && !ANYWHERE.test(name!) && !WORDS.test(name!)
}

/** A name short enough for a phone button: no series tag, and a book without its subtitle. */
export function shortName(name: string, type = ''): string {
  let short = name.replace(/\s*\([^)]*#\s*\d+[^)]*\)\s*$/, '').trim()
  if (type.endsWith('book') && short.includes(': ')) {
    const head = short.slice(0, short.indexOf(': ')).trim()
    if (head.length >= 3) short = head
  }
  return short || name
}

/** The town as a room says it: "Glasgow" for "Glasgow, Scotland". */
export function townName(town: string): string {
  return town.split(',')[0].trim() || town
}

const GENERIC = new Set(['downtown', 'north', 'south', 'east', 'west', 'end', 'the', 'centre', 'center', 'old', 'new', 'upper', 'lower'])

/** True when a place's own name holds the answer: "Sobeys Spryfield" asked as "which part of town is it in?". */
export function namesItsArea(placeName: string, area: string, town: string): boolean {
  const own = new Set(placeName.toLowerCase().split(/[^\p{L}]+/u))
  const townWords = new Set(town.toLowerCase().split(/[^\p{L}]+/u))
  return area.toLowerCase().split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 4 && !GENERIC.has(word) && !townWords.has(word))
    .some((word) => own.has(word))
}
