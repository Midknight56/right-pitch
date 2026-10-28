// Pure helpers shared by the pages. Unit tested in tests/unit/lib.test.ts.

/** Splits a streamed NDJSON body into values; a line that does not parse becomes an error event. */
export function createNdjsonSplitter(onValue) {
  let pending = ''
  return {
    push(chunk) {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) parse(line, onValue)
    },
    end() {
      parse(pending, onValue)
      pending = ''
    },
  }
}

function parse(line, onValue) {
  if (!line.trim()) return
  try {
    onValue(JSON.parse(line))
  } catch {
    onValue({ t: 'error', text: 'A server update could not be read.' })
  }
}

/** A 0 to 1 value as a 0 to 100 percentage, clamped. */
export function meterPosition(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n * 100)) : 0
}

export function optionLetter(index) {
  return String.fromCharCode(65 + index)
}

/** Whole seconds left until endsAt, never below 0. */
export function countdown(endsAt, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(endsAt) - now) / 1000))
}

/** The question's end on this phone's clock: the room sends its own now, so a phone with a wrong clock still counts right. */
export function localEnd(message, receivedAt = Date.now()) {
  if (typeof message.now === 'number') return receivedAt + (message.endsAt - message.now)
  return message.endsAt
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])
}

/** "0.93" for a popularity percentile. */
export function pct(value) {
  return Number(value ?? 0).toFixed(2)
}

/** Plain words for one Qloo call in the build log. */
export function describeCall(event) {
  const p = event.params || {}
  const type = (p['filter.type'] || p.types || '').replace('urn:entity:', '').replace('_', ' ')
  const bits = []
  if (event.path === '/search') bits.push(`search "${p.query ?? ''}"`)
  else bits.push(`insights ${type}`)
  if (p['filter.popularity.min'] || p['filter.popularity.max']) {
    bits.push(`popularity ${p['filter.popularity.min'] ?? '0'} to ${p['filter.popularity.max'] ?? '1'}`)
  }
  if (p['signal.location.query']) bits.push(`loved in ${p['signal.location.query']}`)
  if (p['filter.location.query']) bits.push(`in ${p['filter.location.query']}`)
  if (p['signal.demographics.age']) bits.push(`ages ${ageWords(p['signal.demographics.age'])}`)
  const yearMin = p['filter.release_year.min'] || p['filter.publication_year.min']
  const yearMax = p['filter.release_year.max'] || p['filter.publication_year.max']
  if (yearMin || yearMax) bits.push(`${yearMin ?? ''} to ${yearMax ?? ''}`)
  if (p['filter.results.entities']) bits.push(`${p['filter.results.entities'].split(',').length} items scored`)
  const tail = `${event.results} back, ${event.ms} ms${event.cached ? ', cached' : ''}`
  return `${bits.join(', ')}. ${tail}`
}

const AGE_WORDS = {
  '24_and_younger': '24 and under', '25_to_29': '25 to 29', '30_to_34': '30 to 34',
  '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55 and over',
}
export function ageWords(list) {
  return String(list).split(',').map((a) => AGE_WORDS[a] ?? a).join(', ')
}

export const KIND_WORDS = {
  film: 'Film', telly: 'Telly', books: 'Books', faces: 'Famous faces',
  music: 'Music', generation: 'Generation game', local: 'Local', room: "The room's round",
}

/** The round kinds a host can pick in the builder. */
export const BUILD_KINDS = Object.keys(KIND_WORDS).filter((kind) => kind !== 'room')

export const LEVEL_WORDS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', deep: 'Deep cut' }

// The words for a record's field on the record sheet.
const FIELD_WORDS = {
  release_year: 'Released', publication_year: 'Published', start_year: 'Started', date_of_birth: 'Born',
  imdb_rating: 'IMDb rating', user_rating: 'Rating', business_rating: 'Rating', neighborhood: 'Neighbourhood',
}

export function fieldLabel(field) {
  if (FIELD_WORDS[field]) return FIELD_WORDS[field]
  const words = String(field).split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A popularity value placed on the meter, whose track runs from 0.5 (left) to 1 (right). */
export function meterSpot(value) {
  return meterPosition((Number(value) - 0.5) / 0.5)
}

/** A random player id the room accepts: 20 letters and digits. */
export function newPid(random = Math.random) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 20; i += 1) id += abc[Math.floor(random() * abc.length)]
  return id
}

/** Storage that never throws: a private window or blocked storage just forgets. */
export const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* forgets */ }
  },
}
