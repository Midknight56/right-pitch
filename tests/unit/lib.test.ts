import { describe, expect, it } from 'vitest'
import { BUILD_KINDS, countdown, createNdjsonSplitter, meterPosition, optionLetter, readWithIdle } from '../../public/lib.js'
import { ROUND_KINDS } from '../../src/quiz/types'

describe('public helpers', () => {
  it('ends an idle reader and cancels it', async () => {
    let cancelled = false
    const reader = {
      read: () => new Promise<ReadableStreamReadResult<string>>(() => {}),
      cancel: async () => { cancelled = true },
    }

    await expect(readWithIdle(reader, 50)).rejects.toMatchObject({ name: 'IdleReaderError' })
    expect(cancelled).toBe(true)
  })
  it('rejects an idle real stream reader before cancellation ends its pending read', async () => {
    const stream = new ReadableStream<string>({
      start() {},
    })

    await expect(readWithIdle(stream.getReader(), 50)).rejects.toMatchObject({ name: 'IdleReaderError' })
  })
  it('reads chunks that arrive within the idle limit', async () => {
    const chunks = ['one', 'two', 'three']
    const reader = {
      read: async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return chunks.length ? { value: chunks.shift()!, done: false } : { value: undefined, done: true }
      },
      cancel: async () => {},
    }
    const received = []

    for (;;) {
      const result = await readWithIdle(reader, 50)
      if (result.done) break
      received.push(result.value)
    }
    expect(received).toEqual(['one', 'two', 'three'])
  })
  it('splits complete NDJSON rows and flushes the final row', () => {
    const rows: unknown[] = []
    const splitter = createNdjsonSplitter(row => rows.push(row))
    splitter.push('{"t":"call"}\r\n{"t":"done"')
    splitter.push('}\n')
    splitter.end()
    expect(rows).toEqual([{ t: 'call' }, { t: 'done' }])
  })
  it('maps popularity to the meter and clamps to its scale', () => {
    expect([meterPosition(-1), meterPosition(0.42), meterPosition(2)]).toEqual([0, 42, 100])
  })
  it('returns option labels and a nonnegative countdown', () => {
    expect([optionLetter(0), optionLetter(3)]).toEqual(['A', 'D'])
    expect(countdown(12000, 10001)).toBe(2)
    expect(countdown(9000, 10000)).toBe(0)
  })
})

describe('the builder round chips', () => {
  it('offers exactly the kinds a build accepts: the room round is made by a room, never picked', () => {
    // A "room" chip in the builder made the build answer "Invalid setup." (found 28 Oct).
    expect([...BUILD_KINDS].sort()).toEqual([...ROUND_KINDS].sort())
  })
})
