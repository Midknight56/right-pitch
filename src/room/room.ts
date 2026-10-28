import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../worker'
import type { Quiz } from '../quiz/types'
import { DAILY_QLOO_CALLS, ROOM_HOURS, ROOM_ROUND_CALLS } from '../limits'
import { QlooClient } from '../qloo/client'
import { D1Cache, D1Quota } from '../store/d1'
import { refuse } from './refuse'
import { createGame, join, lobby, lock, type Answer, type RoomState, snapshot } from './game'
import { allowSocketOpen, dispatchRoomMessage, inspectRoomMessage } from './adapter'
import { startWithRoomRound } from './taste'

type Attachment = {
  role: 'host' | 'player'
  pid: string
  sent: number
  answer?: { n: number; choice: number; at: number }
}
const KEY = 'room'

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null
  /** The room's round while it is being built, so a second Start waits for the same one. */
  private building: Promise<RoomState> | null = null

  private async load(): Promise<RoomState | null> {
    return this.state ?? (this.state = (await this.ctx.storage.get<RoomState>(KEY)) ?? null)
  }

  private async save(state: RoomState): Promise<void> {
    this.state = state
    await this.ctx.storage.put(KEY, state)
  }

  async init(quiz: Quiz, code: string, now: number): Promise<void> {
    if (await this.load()) throw new Error('Room already initialized')
    const state = createGame(quiz, code, now)
    await this.save(state)
    await this.ctx.storage.setAlarm(now + ROOM_HOURS * 60 * 60 * 1000)
  }

  async info(): Promise<{ exists: boolean; phase?: string; players?: number }> {
    const state = await this.load()
    if (!state || Date.now() >= state.createdAt + ROOM_HOURS * 60 * 60 * 1000) {
      return { exists: false }
    }
    return { exists: true, phase: state.phase, players: Object.keys(state.players).length }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    let state = await this.load()
    if (!state) return refuse('This room has closed.', 404)
    if (Date.now() >= state.createdAt + ROOM_HOURS * 60 * 60 * 1000) return refuse('This room has expired.', 410)
    state = this.hydrateAnswers(state)
    const url = new URL(request.url)
    const role = request.headers.get('x-role')
    if (role !== 'host' && role !== 'player') return new Response('Forbidden', { status: 403 })
    const pid = role === 'host' ? 'host' : (url.searchParams.get('pid') ?? '')
    if (!allowSocketOpen(state.opens)) return refuse('This room is full.', 429)
    if (role === 'player') {
      const result = join(state, pid, url.searchParams.get('nick') ?? '', Date.now(), url.searchParams.get('fav') ?? '')
      if (result.messages.some((message) => message.msg.type === 'error')) {
        return refuse(String(result.messages[0].msg.text), 403)
      }
      const nextState = { ...result.state, opens: result.state.opens + 1 }
      await this.save(nextState)
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      const ws = server as WebSocket
      ws.serializeAttachment({ role, pid, sent: 0 } satisfies Attachment)
      this.ctx.acceptWebSocket(ws, ['player', pid])
      for (const other of this.ctx.getWebSockets()) this.sendTo(other, result.messages)
      if (nextState.phase !== 'lobby') this.sendTo(ws, snapshot(nextState, pid, Date.now()))
      return new Response(null, { status: 101, webSocket: client })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const ws = server as WebSocket
    ws.serializeAttachment({ role, pid, sent: 0 } satisfies Attachment)
    this.ctx.acceptWebSocket(ws, ['host'])
    state = { ...state, opens: state.opens + 1 }
    await this.save(state)
    this.sendTo(ws, snapshot(state, 'host', Date.now()))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let state = await this.load()
    const att = ws.deserializeAttachment() as Attachment | null
    if (!state || !att) return
    const inspected = inspectRoomMessage(att, message)
    ws.serializeAttachment({ ...att, sent: inspected.sent })
    if (!inspected.allowed) {
      ws.close(1008, 'Message limit reached')
      return
    }
    const input = inspected.input as {
      type?: string
      n?: number
      q?: number
      choice?: number
      pid?: string
    } | null
    if (!input) return
    if (att.role === 'host' && input.type === 'start' && state.phase === 'lobby' && !state.roomRound) {
      await this.roomRound(state)
      state = await this.load()
      if (!state) return
    }
    const now = Date.now()
    if (att.answer?.n === input.q && att.role === 'player') return
    const result = dispatchRoomMessage(state, att.role, att.pid, input, now)
    if (att.role === 'player') {
      if (!result.answer) return
      ws.serializeAttachment({ ...att, answer: result.answer } satisfies Attachment)
      this.state = result.state
      const sockets = this.ctx.getWebSockets('player')
      const answers = this.collectAnswers(sockets, result.answer.n)
      const connected = new Set(sockets
        .map((socket) => (socket.deserializeAttachment() as Attachment | null)?.pid)
        .filter((connectedPid): connectedPid is string => !!connectedPid))
      if (connected.size > 0 && answers.length >= connected.size) {
        await this.apply(lock(this.state, answers, now))
      }
      return
    }
    const kickedPid = input.type === 'kick' && typeof input.pid === 'string' ? input.pid : null
    if (result.state !== state || result.messages.length) await this.apply(result)
    if (kickedPid) {
      for (const socket of this.ctx.getWebSockets(kickedPid)) {
        try {
          socket.close(1008, 'Removed from room')
        } catch {
          // The socket may have disconnected between the lookup and close.
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code)
    } catch {
      // The runtime may have already closed the socket.
    }
    const attachment = ws.deserializeAttachment() as Attachment | null
    const state = await this.load()
    if (attachment?.role !== 'player' || state?.phase !== 'lobby') return
    const connected = new Set(this.ctx.getWebSockets('player')
      .filter((socket) => socket !== ws)
      .map((socket) => (socket.deserializeAttachment() as Attachment | null)?.pid)
      .filter((pid): pid is string => !!pid))
    const message = lobby(state, connected)
    for (const socket of this.ctx.getWebSockets()) this.sendTo(socket, [message])
  }

  async webSocketError(): Promise<void> {
    // Hibernating sockets are removed by the runtime.
  }

  async alarm(): Promise<void> {
    const state = await this.load()
    if (!state) return
    const expiry = state.createdAt + ROOM_HOURS * 60 * 60 * 1000
    const now = Date.now()
    if (now >= expiry) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1001, 'Room expired')
        } catch {
          // The socket may already be closed.
        }
      }
      this.state = null
      await this.ctx.storage.deleteAll()
      return
    }
    if (state.phase === 'question' && now >= state.endsAt) {
      const answers = this.collectAnswers(this.ctx.getWebSockets('player'), state.n)
      await this.apply(lock(state, answers, now))
    }
    const current = await this.load() ?? state
    const nextAlarm = current.phase === 'question'
      ? Math.min(current.endsAt, expiry)
      : expiry
    await this.ctx.storage.setAlarm(nextAlarm)
  }

  /** Builds the room's own round once, before the first question; the planned round plays if it cannot be built. */
  private async roomRound(state: RoomState): Promise<RoomState> {
    this.building ??= (async () => {
      const ready = await startWithRoomRound(state, this.env.QLOO_API_KEY ? this.qloo() : null)
      // Players who joined while Qloo answered are kept.
      const latest = (await this.load()) ?? state
      const next = { ...latest, quiz: ready.quiz, roomRound: ready.roomRound }
      await this.save(next)
      return next
    })()
    try {
      return await this.building
    } finally {
      this.building = null
    }
  }

  /** A Qloo client for one room's round: cached answers are free; each live call takes one from the Worker's daily
   *  Qloo count (the builds' own) and at most ROOM_ROUND_CALLS go out for one room. */
  private qloo(): QlooClient {
    const day = new Date().toISOString().slice(0, 10)
    const total = this.env.COUNTERS.get(this.env.COUNTERS.idFromName('qloo-total'))
    let calls = 0
    return new QlooClient(this.env.QLOO_API_KEY ?? '', fetch, new D1Cache(this.env.DB), async () => {
      if (calls >= ROOM_ROUND_CALLS) return false
      calls++
      return total.take(day, DAILY_QLOO_CALLS)
    }, { quota: new D1Quota(this.env.DB) })
  }

  private hydrateAnswers(state: RoomState): RoomState {
    if (state.phase !== 'question') return state
    const players = { ...state.players }
    for (const socket of this.ctx.getWebSockets('player')) {
      const attachment = socket.deserializeAttachment() as Attachment | null
      if (attachment?.answer?.n !== state.n || !players[attachment.pid]) continue
      players[attachment.pid] = {
        ...players[attachment.pid],
        last: { n: state.n, right: false, points: 0 },
      }
    }
    const hydrated = { ...state, players }
    this.state = hydrated
    return hydrated
  }

  private collectAnswers(sockets: WebSocket[], n: number): Answer[] {
    const out: Answer[] = []
    for (const ws of sockets) {
      const a = ws.deserializeAttachment() as Attachment | null
      if (a?.role === 'player' && a.answer?.n === n) {
        out.push({ pid: a.pid, choice: a.answer.choice, at: a.answer.at })
      }
    }
    return out
  }
  private sendTo(ws: WebSocket, messages: { to: string; msg: Record<string, unknown> }[]): void {
    const attachment = ws.deserializeAttachment() as Attachment | null
    for (const item of messages) {
      const recipient = item.to === 'all'
        || (item.to === 'players' && attachment?.role === 'player')
        || item.to === attachment?.pid
      if (!recipient) continue
      try {
        ws.send(JSON.stringify(item.msg))
      } catch {
        // A socket may disconnect between event delivery and broadcast.
      }
    }
  }
  private async apply(result: { state: RoomState; messages: { to: string; msg: Record<string, unknown> }[] }): Promise<void> {
    if (result.state !== this.state) await this.save(result.state)
    const all = this.ctx.getWebSockets()
    for (const ws of all) this.sendTo(ws, result.messages)
    const expiry = result.state.createdAt + ROOM_HOURS * 60 * 60 * 1000
    const alarm = result.state.phase === 'question'
      ? Math.min(result.state.endsAt, expiry)
      : expiry
    await this.ctx.storage.setAlarm(alarm)
  }
}
