import { describe, expect, it } from 'vitest'
import { countdown, createNdjsonSplitter, meterPosition, optionLetter } from '../../public/lib.js'

describe('public helpers', () => {
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
