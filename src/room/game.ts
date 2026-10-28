import type { PublicQuestion, Quiz, Question } from '../quiz/types'
import { FAVOURITE_MAX, NICKNAME_MAX, PLAYERS_PER_ROOM, QUESTION_SECONDS, ROOM_FAVOURITES, ROOM_HOURS } from '../limits'
import { fitForRoom } from '../quiz/fit'

export type Phase = 'lobby' | 'question' | 'reveal' | 'end'
export interface Player {
  nick: string
  score: number
  joinedAt: number
  /** One favourite the player typed at join, for the room's own round. */
  fav?: string
  last?: { n: number; right: boolean; points: number }
}
export interface RoomState {
  code: string
  createdAt: number
  quiz: Quiz
  phase: Phase
  n: number
  endsAt: number
  players: Record<string, Player>
  opens: number
  kicked: string[]
  lastReveal?: { n: number; counts: number[] }
  /** Set once at Start: whether the room's own round replaced the last planned round, and why not. */
  roomRound?: { built: boolean; why?: string }
}
export interface Outgoing {
  to: 'all' | 'host' | 'players' | string
  msg: Record<string, unknown>
}
export interface Answer {
  pid: string
  choice: number
  at: number
}
export type Result = { state: RoomState; messages: Outgoing[] }

export function createGame(quiz: Quiz, code: string, createdAt: number): RoomState {
  return { code, createdAt, quiz, phase: 'lobby', n: -1, endsAt: 0, players: {}, opens: 0, kicked: [] }
}

export function questions(quiz: Quiz): Question[] {
  return quiz.rounds.flatMap((round) => round.questions)
}

function send(msg: Record<string, unknown>, to: Outgoing['to'] = 'all'): Outgoing {
  return { to, msg }
}

export function lobby(state: RoomState, connected?: Set<string>): Outgoing {
  const players = Object.entries(state.players).map(([pid, player]) => ({
    nick: player.nick,
    fav: Boolean(player.fav),
    ...(connected ? { connected: connected.has(pid) } : {}),
  }))
  return send({ type: 'lobby', players })
}

function scores(state: RoomState, onlyPid?: string | null): Outgoing[] {
  const ranked = Object.values(state.players).sort((a, b) => b.score - a.score)
  const top = ranked.slice(0, 10).map(({ nick, score }) => ({ nick, score }))
  const messages = [send({ type: 'scores', top })]
  const entries = onlyPid === null
    ? []
    : Object.entries(state.players).filter(([pid]) => !onlyPid || pid === onlyPid)
  for (const [pid, player] of entries) {
    messages.push(send({
      type: 'you',
      score: player.score,
      rank: ranked.indexOf(player) + 1,
      last: player.last ?? null,
    }, pid))
  }
  return messages
}

/** What phones see of the question. `now` is the room's clock, so a phone can count down on its own clock. */
function publicQuestion(state: RoomState, now: number): PublicQuestion | null {
  const qs = questions(state.quiz)
  const q = qs[state.n]
  if (!q) return null
  const round = state.quiz.rounds.find((r) => r.questions.includes(q))
  return {
    n: state.n,
    of: qs.length,
    round: round?.title ?? '',
    kind: round?.kind ?? '',
    prompt: q.prompt,
    options: q.options.map((option) => option.label),
    endsAt: state.endsAt,
    now,
  }
}

function reveal(state: RoomState): Outgoing | null {
  const question = questions(state.quiz)[state.n]
  if (!question) return null
  const counts = state.lastReveal?.n === state.n
    ? state.lastReveal.counts
    : Array(question.options.length).fill(0) as number[]
  return send({
    type: 'reveal',
    n: state.n,
    answer: question.answer,
    counts,
    record: question.options.map((option) => option.record ?? null),
    lens: question.lens ?? null,
    reveal: question.reveal,
  })
}

export function snapshot(state: RoomState, pid: string | 'host', now: number): Outgoing[] {
  if (state.phase === 'lobby') return [lobby(state)]
  if (state.phase === 'question') {
    const question = publicQuestion(state, now)
    const messages = question ? [send({ type: 'question', ...question })] : []
    if (pid !== 'host' && state.players[pid]?.last?.n === state.n) {
      const answered = Object.values(state.players).filter((player) => player.last?.n === state.n).length
      messages.push(send({ type: 'locked', n: state.n, answered }, pid))
    }
    return messages
  }
  if (state.phase === 'reveal') {
    // The question goes first, so a screen that comes back during a reveal can draw the prompt and the tiles.
    const question = publicQuestion(state, now)
    const message = reveal(state)
    return [
      ...(question ? [send({ type: 'question', ...question })] : []),
      ...(message ? [message] : []),
      ...scores(state, pid === 'host' ? null : pid),
    ]
  }
  const top = Object.values(state.players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ nick, score }) => ({ nick, score }))
  return [send({ type: 'end', top })]
}

/** A favourite as typed, or nothing: letters, digits and the marks titles use, and no word unfit for the big screen.
 *  A favourite that does not pass is dropped and the player still joins. */
function cleanFavourite(text: string): string | undefined {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!new RegExp(`^[\\p{L}\\p{N} .,'&:!?-]{1,${FAVOURITE_MAX}}$`, 'u').test(clean)) return undefined
  return fitForRoom(clean) ? clean : undefined
}

/** The favourites the room's round is built from: join order, one per title, at most ROOM_FAVOURITES. */
export function favourites(state: RoomState): { nick: string; text: string }[] {
  const seen = new Set<string>()
  const out: { nick: string; text: string }[] = []
  for (const player of Object.values(state.players).sort((a, b) => a.joinedAt - b.joinedAt)) {
    const key = player.fav?.toLocaleLowerCase()
    if (!player.fav || !key || seen.has(key)) continue
    seen.add(key)
    out.push({ nick: player.nick, text: player.fav })
    if (out.length === ROOM_FAVOURITES) break
  }
  return out
}

export function join(state: RoomState, pid: string, nick: string, now: number, fav = ''): Result {
  if (state.kicked.includes(pid)) return { state, messages: [send({ type: 'error', text: 'You were removed from this room.' }, pid)] }
  if (now >= state.createdAt + ROOM_HOURS * 60 * 60 * 1000) {
    const message = send({ type: 'error', text: 'This room has expired.' }, pid)
    return { state, messages: [message] }
  }
  if (state.players[pid]) return { state, messages: [lobby(state)] }
  const clean = nick.trim()
  if (!new RegExp(`^[\\p{L}\\p{N} ]{1,${NICKNAME_MAX}}$`, 'u').test(clean)) {
    return { state, messages: [send({ type: 'error', text: `Nickname must be 1 to ${NICKNAME_MAX} letters, digits or spaces.` }, pid)] }
  }
  if (Object.keys(state.players).length >= PLAYERS_PER_ROOM) {
    return { state, messages: [send({ type: 'error', text: 'This room is full.' }, pid)] }
  }
  const names = new Set(Object.entries(state.players).filter(([id]) => id !== pid).map(([, p]) => p.nick.toLocaleLowerCase()))
  let unique = clean
  let suffix = 2
  while (names.has(unique.toLocaleLowerCase())) {
    const ending = ` ${suffix++}`
    unique = `${Array.from(clean).slice(0, NICKNAME_MAX - ending.length).join('').trimEnd()}${ending}`
  }
  const favourite = cleanFavourite(fav)
  const player: Player = { nick: unique, score: 0, joinedAt: now, ...(favourite ? { fav: favourite } : {}) }
  const next = { ...state, players: { ...state.players, [pid]: player } }
  return { state: next, messages: [lobby(next)] }
}

export function start(state: RoomState, now: number): Result {
  if (state.phase !== 'lobby' || !questions(state.quiz).length) return { state, messages: [] }
  const next = { ...state, phase: 'question' as const, n: 0, endsAt: now + QUESTION_SECONDS * 1000 }
  return { state: next, messages: [send({ type: 'question', ...publicQuestion(next, now) })] }
}

export function answer(state: RoomState, pid: string, n: number, choice: number, now: number): Result {
  if (state.phase !== 'question' || n !== state.n || now >= state.endsAt || !state.players[pid]) return { state, messages: [] }
  const q = questions(state.quiz)[state.n]
  if (!q || !Number.isInteger(choice) || choice < 0 || choice >= q.options.length
    || state.players[pid].last?.n === n) {
    return { state, messages: [] }
  }
  // The caller keeps the answer in the socket attachment; this marks it solely for duplicate-answer prevention.
  const player = { ...state.players[pid], last: { n, right: false, points: 0 } }
  return { state: { ...state, players: { ...state.players, [pid]: player } }, messages: [] }
}

export function lock(state: RoomState, answers: Answer[], _now: number): Result {
  if (state.phase !== 'question') return { state, messages: [] }
  const q = questions(state.quiz)[state.n]
  if (!q) return end(state)
  const unique = new Map<string, Answer>()
  for (const answer of answers) {
    if (state.players[answer.pid] && !unique.has(answer.pid) && answer.choice >= 0 && answer.choice < q.options.length) {
      unique.set(answer.pid, answer)
    }
  }
  const counts = Array(q.options.length).fill(0) as number[]
  const players = { ...state.players }
  for (const playerAnswer of unique.values()) {
    counts[playerAnswer.choice]++
    const right = playerAnswer.choice === q.answer
    const remaining = Math.max(0, Math.min(QUESTION_SECONDS * 1000, state.endsAt - playerAnswer.at))
    const points = right ? 1000 + Math.round(500 * remaining / (QUESTION_SECONDS * 1000)) : 0
    const player = players[playerAnswer.pid]
    players[playerAnswer.pid] = { ...player, score: player.score + points, last: { n: state.n, right, points } }
  }
  const next = { ...state, phase: 'reveal' as const, players, lastReveal: { n: state.n, counts } }
  const locked = send({ type: 'locked', n: state.n, answered: unique.size })
  const revealed = reveal(next)
  return {
    state: next,
    messages: [locked, ...(revealed ? [revealed] : []), ...scores(next)],
  }
}

export function next(state: RoomState, now: number): Result {
  if (state.phase !== 'reveal') return { state, messages: [] }
  if (state.n + 1 >= questions(state.quiz).length) return end(state)
  const n = state.n + 1
  const nextState = { ...state, phase: 'question' as const, n, endsAt: now + QUESTION_SECONDS * 1000 }
  return { state: nextState, messages: [send({ type: 'question', ...publicQuestion(nextState, now) })] }
}

export function end(state: RoomState): Result {
  if (state.phase === 'end') return { state, messages: [] }
  const top = Object.values(state.players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ nick, score }) => ({ nick, score }))
  return { state: { ...state, phase: 'end' }, messages: [send({ type: 'end', top })] }
}

export function kick(state: RoomState, pid: string): Result {
  if (!state.players[pid]) return { state, messages: [] }
  const players = { ...state.players }
  delete players[pid]
  const nextState = { ...state, players, kicked: [...new Set([...state.kicked, pid])] }
  const removed = send({ type: 'error', text: 'You were removed from this room.' }, pid)
  return { state: nextState, messages: [removed, lobby(nextState)] }
}
