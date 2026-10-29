export const BUILD_IDLE_MS: number
export function readWithIdle<T>(reader: Pick<ReadableStreamDefaultReader<T>, 'read' | 'cancel'>, ms: number): Promise<ReadableStreamReadResult<T>>
export function createNdjsonSplitter(onValue: (value: any) => void): { push(chunk: string): void; end(): void }
export function meterPosition(value: number): number
export function optionLetter(index: number): string
export function countdown(endsAt: number, now?: number): number
export function localEnd(message: { endsAt: number; now?: number }, receivedAt?: number): number
export function esc(value: unknown): string
export function pct(value: unknown): string
export function describeCall(event: { path: string; params?: Record<string, string>; results: number; ms: number; cached?: boolean }): string
export function ageWords(list: string): string
export const KIND_WORDS: Record<string, string>
export const BUILD_KINDS: string[]
export const LEVEL_WORDS: Record<string, string>
export function fieldLabel(field: string): string
export function meterSpot(value: number): number
export function newPid(random?: () => number): string
export const store: { get(key: string): any; set(key: string, value: unknown): void }
