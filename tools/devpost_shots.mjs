// Gallery pictures of the live host for the Devpost page, 1500 x 1000, Chalkboard. Zero spend: the first preset plays
// from the run cache. One room is opened and saved to out/devpost/room.json, so a second run reuses it.
//
//   python A:/Projects/shipatonv2/tools/pw_lock.py run right-pitch -- node tools/devpost_shots.mjs [base url]
//
// Writes out/devpost/raw/: built.png and record.png (1545 x 1030), and at 1500 x 1000 lobby.png, phone-question.png, reveal.png. Headless, one browser.
// --reshoot: the builder pictures again, then the saved room's host screen as it stands (its reveal), no phones.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = (process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'https://right-pitch.midknight-labs.workers.dev').replace(/\/$/, '')
const OUT = fileURLToPath(new URL('../out/devpost/', import.meta.url))
const RAW = `${OUT}raw/`
mkdirSync(RAW, { recursive: true })
const ROOM = `${OUT}room.json`
const size = { width: 1500, height: 1000 }
// The builder is shot a little bigger and scaled to 1500 x 1000 later: at 1000 tall its last row of round chips is cut
// at the bottom edge, and at 1030 the edge falls in a gap with no text (rows 1025 to 1036 of the page, measured 26 Oct).
const builderSize = { width: 1545, height: 1030 }
const reshoot = process.argv.includes('--reshoot')

const browser = await chromium.launch({ headless: true })
try {
  const host = await (await browser.newContext({ viewport: builderSize, deviceScaleFactor: 1 })).newPage()
  await host.goto(BASE + '/')
  await host.click('[data-preset="0"]')
  await host.click('[data-build]')
  await host.waitForSelector('[data-open]', { timeout: 120_000 })
  const usage = await host.locator('body').innerText()
  console.log(usage.includes('0 Qloo calls') ? 'built from the cache' : 'check the build: it may not be from the cache')
  // The top of the page: the setup, the build log with its Qloo calls, and the first round's meter.
  await host.evaluate(() => window.scrollTo(0, 0))
  await host.waitForTimeout(400)
  await host.screenshot({ path: `${RAW}built.png` })

  await host.locator('.round .tick', { hasText: '✓' }).first().click()
  await host.waitForSelector('.sheet-card')
  await host.waitForTimeout(300)
  await host.screenshot({ path: `${RAW}record.png` })
  await host.click('[data-close]')

  // The room: reuse the saved one, or open one (rooms are capped at 3 a visitor a day).
  const quiz = await host.evaluate(() => JSON.parse(localStorage.getItem('rp-last-quiz')))
  let room = existsSync(ROOM) ? JSON.parse(readFileSync(ROOM, 'utf8')) : null
  if (!room || room.quiz !== quiz) {
    room = await host.evaluate(async (id) => {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quiz: id }) })
      const body = await r.json()
      return { status: r.status, code: body.code, token: body.hostToken, quiz: id }
    }, quiz)
    if (room.status !== 201) throw new Error(`room HTTP ${room.status}`)
    writeFileSync(ROOM, JSON.stringify(room))
  }
  await host.evaluate((r) => localStorage.setItem(`rp-host-${r.code}`, JSON.stringify({ token: r.token, quiz: r.quiz })), room)
  await host.setViewportSize(size)
  await host.goto(`${BASE}/h/${room.code}`)
  if (reshoot) {
    await host.waitForSelector('.score-list', { timeout: 20_000 })
    await host.waitForLoadState('networkidle')
    await host.waitForTimeout(600)
    await host.screenshot({ path: `${RAW}reveal.png` })
    console.log(`room ${room.code} as it stands; pictures in ${RAW}`)
    await browser.close()
    process.exit(0)
  }
  await host.waitForSelector('.join-code')

  const phone = async (nick) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
    await page.goto(`${BASE}/j/${room.code}`)
    await page.fill('input[name=nick]', nick)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=You\'re in')
    return page
  }
  const ann = await phone('Ann')
  const bo = await phone('Bo')
  await host.waitForFunction(() => document.querySelectorAll('.player').length === 2)
  await host.waitForLoadState('networkidle')
  await host.waitForTimeout(500)
  await host.screenshot({ path: `${RAW}lobby.png` })

  await host.click('[data-go]')
  await ann.waitForSelector('[data-choice]')
  await bo.waitForSelector('[data-choice]')
  await ann.waitForTimeout(400)
  await ann.screenshot({ path: `${RAW}phone-question.png` })
  const answer = await host.evaluate(async (id) => (await (await fetch(`/api/quiz/${id}`)).json()).rounds[0].questions[0].answer, quiz)
  await ann.click(`[data-choice="${answer}"]`)
  await bo.click(`[data-choice="${(answer + 1) % 4}"]`)
  await host.waitForSelector('.score-list', { timeout: 30_000 })
  await host.waitForTimeout(600)
  await host.screenshot({ path: `${RAW}reveal.png` })
  console.log(`room ${room.code}; pictures in ${RAW}`)
} finally {
  await browser.close()
}
