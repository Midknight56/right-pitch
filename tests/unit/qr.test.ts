import { describe, expect, it } from 'vitest'
import { encodeQr, qrSvg } from '../../public/qr.js'
import qrcode from 'qrcode-generator'

describe('QR encoder', () => {
  it('renders a valid SVG and preserves finder patterns for versions 1 to 6', () => {
    for (let version = 1; version <= 6; version++) {
      const { matrix, version: actual } = encodeQr('HELLO WORLD', version)
      const size = version * 4 + 17
      expect(actual).toBe(version)
      expect(matrix).toHaveLength(size)
      expect(matrix.every(row => row.length === size)).toBe(true)
      for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
        for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
          const expected = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          expect(matrix[r0 + r][c0 + c]).toBe(expected)
        }
      }
    }
    expect(qrSvg('HELLO WORLD')).toContain('<svg')
  })

  it('matches the published HELLO WORLD byte mode matrix at version 1 M', () => {
    const expected = qrcode(1, 'M')
    expected.addData('HELLO WORLD', 'Byte')
    expected.make()
    const actual = encodeQr('HELLO WORLD', 1, 3).matrix
    const reference = Array.from({ length: expected.getModuleCount() }, (_, r) =>
      Array.from({ length: expected.getModuleCount() }, (_, c) => expected.isDark(r, c)))
    expect(actual).toEqual(reference)
  })

  it('rejects payloads longer than the supported versions', () => {
    expect(() => encodeQr('X'.repeat(150))).toThrow()
  })
})
