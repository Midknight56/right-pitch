import {
  HOST_MESSAGES_PER_SOCKET,
  PLAYER_MESSAGES_PER_SOCKET,
  SOCKET_OPENS_PER_ROOM,
} from '../limits'
import { answer, end, kick, next, start, type Outgoing, type RoomState } from './game'

export function allowSocketOpen(opens: number): boolean {
  return opens < SOCKET_OPENS_PER_ROOM
}

export function countSocketMessage(
  attachment: { role: string; sent: number },
): { allowed: boolean; sent: number } {
  const next = attachment.sent + 1
  const limit = attachment.role === 'host' ? HOST_MESSAGES_PER_SOCKET : PLAYER_MESSAGES_PER_SOCKET
  return { allowed: next <= limit, sent: next }
}

export function parseRoomMessage(raw: string | ArrayBuffer): Record<string, unknown> | null {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > 512) {
    return null
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function inspectRoomMessage(
  attachment: { role: string; sent: number },
  raw: string | ArrayBuffer,
): { allowed: boolean; sent: number; input: Record<string, unknown> | null } {
  const count = countSocketMessage(attachment)
  return {
    ...count,
    input: count.allowed ? parseRoomMessage(raw) : null,
  }
}

export function dispatchRoomMessage(
  state: RoomState,
  role: 'host' | 'player',
  pid: string,
  input: Record<string, unknown>,
  now: number,
): { state: RoomState; messages: Outgoing[]; answer?: { n: number; choice: number; at: number } } {
  if (role === 'player') {
    if (input.type !== 'answer' || !Number.isInteger(input.q) || !Number.isInteger(input.choice)) {
      return { state, messages: [] }
    }
    const n = input.q as number
    const choice = input.choice as number
    const result = answer(state, pid, n, choice, now)
    if (result.state === state) return { state, messages: [] }
    return { ...result, answer: { n, choice, at: now } }
  }
  switch (input.type) {
    case 'start': return start(state, now)
    case 'next': return next(state, now)
    case 'end': return end(state)
    case 'kick': return typeof input.pid === 'string' ? kick(state, input.pid) : { state, messages: [] }
    default: return { state, messages: [] }
  }
}
