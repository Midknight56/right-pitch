// A stand in for the Worker, for the picture tools: it serves public/ and answers the API with the made up quiz, and
// a room socket plays scripted messages. No Qloo, no Cloudflare, no money.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUIZ, buildEvents } from './fixtures/quiz.mjs'

const ROOT = fileURLToPath(new URL('../public/', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }

/** Serves public/ on a free port; the page paths fall back to index.html as the Worker does. */
export async function serve() {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    const file = /^\/(h|j)\/[A-Z]{4}\/?$|^\/q\/[^/]+\/print\/?$|^\/$/.test(path) ? 'index.html' : normalize(path).replace(/^[\\/]+/, '')
    try {
      const body = await readFile(join(ROOT, file))
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

/** Answers the API on a Playwright page. `room` is the list of messages the socket sends when it opens. */
export async function mockApi(page, { room = [], palette = null } = {}) {
  if (palette) await page.route('**/theme.css', async (route) => route.fulfill({ contentType: 'text/css', body: await readFile(palette, 'utf8') }))
  await page.route('**/api/presets', (route) => route.fulfill({ json: [{ name: 'Tuesday, a Halifax pub, mostly 30 to 50', setup: QUIZ.setup }, { name: 'Toronto library night', setup: { ...QUIZ.setup, town: 'Toronto' } }] }))
  await page.route('**/api/build', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: buildEvents() }))
  await page.route('**/api/quiz/*', (route) => route.fulfill({ json: QUIZ }))
  await page.route('**/api/rooms', (route) => route.fulfill({ status: 201, json: { code: 'PLMN', hostToken: 'fixture-token' } }))
  await page.route(/\/api\/rooms\/[A-Z]{4}$/, (route) => route.fulfill({ json: { exists: true, phase: 'lobby', players: 0 } }))
  await page.routeWebSocket(/\/api\/rooms\/[A-Z]{4}\/socket/, (ws) => {
    for (const message of room) ws.send(JSON.stringify(message))
  })
}

const flat = QUIZ.rounds.flatMap((r) => r.questions.map((q) => ({ q, r })))
const NICKS = ['Dee', 'Big Al', 'Quizzy McQuiz', 'Priya', 'Tom', 'Sam the Man', 'Lou', 'Fran']

/** The room's messages for one moment of the game, as the real room would send them. */
export function roomScript(moment, n = 0) {
  const now = Date.now()
  const { q, r } = flat[n]
  const question = { type: 'question', n, of: flat.length, round: r.title, kind: r.kind, prompt: q.prompt, options: q.options.map((o) => o.label), endsAt: now + 13_000, now }
  const players = NICKS.map((nick) => ({ nick, connected: true }))
  const top = NICKS.map((nick, i) => ({ nick, score: 4200 - i * 430 }))
  if (moment === 'lobby') return [{ type: 'lobby', players }]
  if (moment === 'question') return [{ type: 'lobby', players }, question]
  if (moment === 'reveal') {
    const counts = q.options.map((_, i) => (i === q.answer ? 5 : 1))
    return [question, { type: 'locked', n, answered: 8 }, { type: 'reveal', n, answer: q.answer, counts, record: q.options.map((o) => o.record), lens: q.lens ?? null, reveal: q.reveal }, { type: 'scores', top }, { type: 'you', score: 3340, rank: 3, last: { n, right: true, points: 860 } }]
  }
  if (moment === 'end') return [{ type: 'end', top }, { type: 'you', score: 3340, rank: 3, last: null }]
  throw new Error(`no moment ${moment}`)
}
