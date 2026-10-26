// Compact byte mode QR encoder for versions 1 to 6, error correction M.
const SPECS = [null,
  { data: 16, blocks: [[1, 16, 10]], align: [] },
  { data: 28, blocks: [[1, 28, 16]], align: [18] },
  { data: 44, blocks: [[1, 44, 26]], align: [22] },
  { data: 64, blocks: [[2, 32, 18]], align: [26] },
  { data: 86, blocks: [[2, 43, 24]], align: [30] },
  { data: 108, blocks: [[4, 27, 16]], align: [34] },
]
const EXP = new Array(512), LOG = new Array(256)
let x = 1
for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0 }
function generator(degree) {
  let p = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(p.length + 1).fill(0)
    for (let j = 0; j < p.length; j++) { next[j] ^= p[j]; next[j + 1] ^= mul(p[j], EXP[i]) }
    p = next
  }
  return p
}
function ecc(data, count) {
  const poly = generator(count), out = [...data, ...new Array(count).fill(0)]
  for (let i = 0; i < data.length; i++) {
    const factor = out[i]
    if (factor) for (let j = 0; j < poly.length; j++) out[i + j] ^= mul(poly[j], factor)
  }
  return out.slice(data.length)
}
function bits(value, count) { const out = []; for (let i = count - 1; i >= 0; i--) out.push((value >>> i) & 1); return out }
function dataCodewords(text, version) {
  const bytes = Array.from(new TextEncoder().encode(text)), spec = SPECS[version]
  if (bytes.length > (version === 1 ? 14 : spec.data - 2)) throw new Error('Text is too long for this QR code')
  let stream = [...bits(4, 4), ...bits(bytes.length, 8)]
  for (const byte of bytes) stream.push(...bits(byte, 8))
  const capacity = spec.data * 8
  stream.push(...new Array(Math.min(4, capacity - stream.length)).fill(0))
  while (stream.length % 8) stream.push(0)
  const data = []
  for (let i = 0; i < stream.length; i += 8) data.push(stream.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0))
  for (let pad = 0; data.length < spec.data; pad++) data.push(pad % 2 ? 0x11 : 0xec)
  const blocks = []
  for (const [num, len, ecLen] of spec.blocks) for (let i = 0; i < num; i++) {
    const part = data.splice(0, len); blocks.push({ data: part, ecc: ecc(part, ecLen) })
  }
  const code = []
  for (let i = 0; i < Math.max(...blocks.map(b => b.data.length)); i++) for (const b of blocks) if (b.data[i] !== undefined) code.push(b.data[i])
  for (let i = 0; i < Math.max(...blocks.map(b => b.ecc.length)); i++) for (const b of blocks) if (b.ecc[i] !== undefined) code.push(b.ecc[i])
  return code.flatMap(byte => bits(byte, 8))
}
function maskBit(mask, r, c) {
  if (mask === 0) return (r + c) % 2 === 0
  if (mask === 1) return r % 2 === 0
  if (mask === 2) return c % 3 === 0
  if (mask === 3) return (r + c) % 3 === 0
  if (mask === 4) return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
  if (mask === 5) return (r * c) % 2 + (r * c) % 3 === 0
  if (mask === 6) return ((r * c) % 2 + (r * c) % 3) % 2 === 0
  return ((r + c) % 2 + (r * c) % 3) % 2 === 0
}
function formatBits(mask) {
  const data = mask // M has format ECL bits 00
  let rem = data << 10
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10)
  return ((data << 10) | rem) ^ 0x5412
}
function make(version, stream, mask) {
  const size = version * 4 + 17, m = Array.from({ length: size }, () => new Array(size).fill(null))
  const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < size && c < size) m[r][c] = !!val }
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) set(r0 + r, c0 + c, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))) }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0)
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const r of SPECS[version].align) for (const c of SPECS[version].align) {
    if (m[r][c] !== null) continue
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
  }
  const f = formatBits(mask)
  for (let i = 0; i < 6; i++) set(i, 8, (f >>> i) & 1)
  set(7, 8, (f >>> 6) & 1); set(8, 8, (f >>> 7) & 1)
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, (f >>> i) & 1)
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, (f >>> i) & 1)
  set(8, 7, (f >>> 8) & 1)
  for (let i = 9; i < 15; i++) set(8, 14 - i, (f >>> i) & 1)
  set(size - 8, 8, true)
  let bit = 0, upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--
    for (let vert = 0; vert < size; vert++) {
      const row = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j++) {
        const col = right - j
        if (m[row][col] !== null) continue
        const b = bit < stream.length ? stream[bit++] : 0
        set(row, col, b ^ Number(maskBit(mask, row, col)))
      }
    }
    upward = !upward
  }
  return m
}
function penalty(m) {
  let score = 0, dark = 0, n = m.length
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++
  for (let axis = 0; axis < 2; axis++) for (let a = 0; a < n; a++) {
    let run = 0, last = null
    for (let b = 0; b < n; b++) { const v = axis ? m[b][a] : m[a][b]; if (v === last) run++; else { if (run >= 5) score += run - 2; run = 1; last = v } }
    if (run >= 5) score += run - 2
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r + 1][c] && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c + 1]) score += 3
  const finderLike = [0b00001011101, 0b10111010000]
  for (let axis = 0; axis < 2; axis++) for (let a = 0; a < n; a++) for (let start = 0; start <= n - 11; start++) {
    let pattern = 0
    for (let k = 0; k < 11; k++) pattern = (pattern << 1) | Number(axis ? m[start + k][a] : m[a][start + k])
    if (finderLike.includes(pattern)) score += 40
  }
  score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10
  return score
}
export function encodeQr(text, forcedVersion, forcedMask) {
  let version = forcedVersion
  if (!version) { version = 1; while (version <= 6) { try { dataCodewords(text, version); break } catch { version++ } } }
  if (version < 1 || version > 6) throw new Error('QR supports versions 1 to 6')
  const stream = dataCodewords(text, version)
  let best, bestScore = Infinity
  for (let mask = forcedMask ?? 0; mask < (forcedMask === undefined ? 8 : forcedMask + 1); mask++) {
    const matrix = make(version, stream, mask), score = penalty(matrix)
    if (score < bestScore) { best = matrix; bestScore = score }
  }
  return { version, matrix: best }
}
export function qrSvg(text) {
  const { matrix } = encodeQr(text), n = matrix.length, quiet = 4
  const rects = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (matrix[y][x]) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + quiet * 2} ${n + quiet * 2}" role="img" aria-label="Join QR code"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects.join('')}</g></svg>`
}
