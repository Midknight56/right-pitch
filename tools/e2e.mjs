// The whole night end to end against a running app: a host screen and two phones, real sockets, real room.
//
//   python A:/Projects/shipatonv2/tools/pw_lock.py run right-pitch -- node tools/e2e.mjs <base url> [--quiz <id>]
//
// With --quiz the host opens a room from that saved quiz; without it the host builds the first preset in the builder.
// Happy path: build or load, open the room, two phones join by the link, the host starts, one phone answers right
// and one wrong, the reveal and scores agree, a phone reloads mid game and comes back, the host screen reloads and
// comes back, every question is played, the end shows on all three.
// Bad path: a code with no room, a refused nickname, a wrong host token, an answer after the lock.
// Headless, one browser; a picture of every step goes to out/e2e/.
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const BASE = (args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const quizArg = args.includes('--quiz') ? args[args.indexOf('--quiz') + 1] : null
const OUT = fileURLToPath(new URL('../out/e2e/', import.meta.url))
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const steps = []
let shot = 0
function step(name, ok, detail = '') {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) throw new Error(name)
}
async function picture(page, name) {
  shot += 1
  await page.screenshot({ path: `${OUT}${String(shot).padStart(2, '0')}-${name}.png` })
}
const text = (page, selector) => page.locator(selector).first().innerText({ timeout: 10_000 })

const browser = await chromium.launch({ headless: true })
const errors = []
const watch = (page, who) => page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`))
try {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  watch(host, 'host')

  // The quiz: built in the builder, or a saved one.
  let quizId = quizArg
  if (!quizId) {
    await host.goto(BASE + '/')
    await host.click('[data-preset="0"]')
    await host.click('[data-build]')
    await host.waitForSelector('[data-open]', { timeout: 120_000 })
    quizId = await host.evaluate(() => JSON.parse(localStorage.getItem('rp-last-quiz')))
    step('the builder built a quiz', Boolean(quizId), quizId)
    await picture(host, 'built')
    await host.click('[data-open]')
  } else {
    await host.goto(BASE + '/')
    const opened = await host.evaluate(async (id) => {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quiz: id }) })
      const body = await r.json()
      if (r.ok) localStorage.setItem(`rp-host-${body.code}`, JSON.stringify({ token: body.hostToken, quiz: id }))
      return { status: r.status, code: body.code }
    }, quizId)
    step('a room opened from the saved quiz', opened.status === 201, `HTTP ${opened.status}`)
    await host.goto(`${BASE}/h/${opened.code}`)
  }
  await host.waitForURL(/\/h\/[A-Z]{4}$/)
  const code = host.url().slice(-4)
  await host.waitForSelector('.join-code')
  step('the host screen shows the code and a QR code', (await text(host, '.join-code')) === code && (await host.locator('.qr-box svg').count()) === 1, code)
  await picture(host, 'lobby-empty')
  const quiz = await host.evaluate(async (id) => (await fetch(`/api/quiz/${id}`)).json(), quizId)
  const flat = quiz.rounds.flatMap((r) => r.questions)

  // Two phones join by the link the QR code holds.
  const phone = async (nick) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
    watch(page, nick)
    await page.goto(`${BASE}/j/${code}`)
    await page.fill('input[name=nick]', nick)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=You\'re in')
    return page
  }
  const ann = await phone('Ann')
  const bo = await phone('Bo')
  await host.waitForFunction(() => document.querySelectorAll('.player').length === 2)
  step('both nicknames show on the host screen', true, (await host.locator('.player').allInnerTexts()).join(', '))
  await picture(host, 'lobby-two')

  // The game. Ann always answers right, Bo always wrong.
  await host.click('[data-go]')
  for (let n = 0; n < flat.length; n += 1) {
    const q = flat[n]
    for (const p of [ann, bo]) await p.waitForFunction((want) => document.querySelector('.q-prompt')?.textContent === want, q.prompt, { timeout: 15_000 })
    if (n === 0) step('the question reaches both phones', true, q.prompt)
    if (n === 1) {
      // Bo's phone drops and comes back mid question.
      await bo.reload()
      await bo.waitForFunction((want) => document.querySelector('.q-prompt')?.textContent === want, q.prompt, { timeout: 15_000 })
      step('a phone that reloads comes back on the same question', true)
      await host.reload()
      await host.waitForSelector('.tiles', { timeout: 15_000 })
      step('the host screen that reloads comes back on the same question', (await text(host, '.prompt')) === q.prompt)
    }
    await ann.click(`[data-choice="${q.answer}"]`)
    if (n === 0) await picture(ann, 'phone-answered')
    await bo.click(`[data-choice="${(q.answer + 1) % q.options.length}"]`)
    await host.waitForSelector('.score-list', { timeout: 25_000 })
    if (n === 0) {
      const counts = await host.locator('.tile-count').allInnerTexts()
      step('the reveal counts one right and one wrong', counts[q.answer] === '1' && counts.reduce((a, c) => a + Number(c), 0) === 2, counts.join(' '))
      await ann.waitForSelector('.verdict')
      await bo.waitForSelector('.verdict')
      step('the right phone says Right and the wrong one does not', (await text(ann, '.verdict')) === 'Right' && (await text(bo, '.verdict')) !== 'Right')
      const top = await host.locator('.score-row .nick').first().innerText()
      step('the scoreboard puts the right answer first', top === 'Ann', top)
      // An answer after the lock changes nothing.
      const late = await bo.evaluate(() => document.querySelectorAll('[data-choice]').length)
      step('a phone has no answer buttons after the lock', late === 0)
      await picture(host, 'reveal')
      await picture(ann, 'phone-right')
      await picture(bo, 'phone-wrong')
    }
    await host.click('[data-go]')
  }
  await host.waitForSelector('.podium')
  step('the end shows the winner on the host screen', (await text(host, '.podium')) === 'Ann')
  await ann.waitForSelector('text=You won')
  step('the winning phone says so', true)
  await picture(host, 'end')
  await picture(ann, 'phone-end')

  // Bad path.
  const stranger = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  watch(stranger, 'stranger')
  await stranger.goto(`${BASE}/j/ZZZZ`)
  await stranger.waitForSelector('text=No room with that code.')
  step('a code with no room says so', true)
  await picture(stranger, 'no-room')

  const rude = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  watch(rude, 'rude')
  await rude.goto(`${BASE}/j/${code}`)
  await rude.fill('input[name=nick]', '<script>')
  await rude.click('button[type=submit]')
  step('a nickname with symbols is refused before it is sent', (await text(rude, '[data-status]')).includes('Letters'))

  const fake = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  watch(fake, 'fake host')
  await fake.addInitScript((c) => localStorage.setItem(`rp-host-${c}`, JSON.stringify({ token: 'not-the-token', quiz: 'x' })), code)
  await fake.goto(`${BASE}/h/${code}`)
  await fake.waitForSelector('text=This is not the host link for this room.', { timeout: 20_000 })
  await picture(fake, 'wrong-host-link')
  step('a wrong host token gets no control of the room', true)
} catch (error) {
  if (!steps.some((s) => !s.ok)) console.log(`FAIL  ${error.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
if (errors.length) {
  console.log(`script errors:\n  ${errors.join('\n  ')}`)
  process.exitCode = 1
}
console.log(`${steps.filter((s) => s.ok).length} of ${steps.length} steps passed; pictures in ${OUT}`)
