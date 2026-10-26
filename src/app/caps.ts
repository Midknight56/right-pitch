import { QLOO_CALLS_PER_BUILD } from '../limits'

export interface Counter {
  take(day: string, limit: number): Promise<boolean>
}

export function canMakeQlooCall(calls: number): boolean {
  return calls < QLOO_CALLS_PER_BUILD
}

export async function allowBuild(counter: Counter, day: string, limit: number): Promise<boolean> {
  return counter.take(day, limit)
}

export async function allowQlooCall(
  visitor: Counter,
  total: Counter,
  day: string,
  visitorLimit: number,
  totalLimit: number,
): Promise<boolean> {
  const visitorAllowed = await visitor.take(day, visitorLimit)
  if (!visitorAllowed) return false
  return total.take(day, totalLimit)
}

