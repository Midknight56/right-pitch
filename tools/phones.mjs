// The phone sweep: every screen at every width a phone shows it, measured, with a picture of each. Headless, one browser.
//
//   python A:/Projects/shipatonv2/tools/pw_lock.py run right-pitch -- node tools/phones.mjs [base url]
//
// With no base url it runs against the stand in server (tools/mock.mjs); with one, against that app, where the
// room screens (and the join screen's room check) still come from the scripted socket so no real room is opened.
// Widths are CSS pixels in portrait: 320 (small Android), 344 (a fold's cover), 360 (Galaxy A05, S21), 375 (iPhone SE),
// 390 (iPhone 14), 393 (iPhone 16), 402 (iPhone 17), 412 (S24+, Pixel), 420 (iPhone Air), 440 (16 Pro Max),
// 466 (iPhone Duo closed), 669 (Duo open), 707 (Fold6 open), 820 (iPad). Estimates from screen sizes, not measured
// browser widths.
// Checks, on every visible control: 16 px or more inside the screen; 44 px or taller; its text inside it with 8 px
// padding; 12 px or more from its neighbours; no overlap; and no sideways scroll on the page.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { mockApi, roomScript, serve } from './mock.mjs'

const OUT = fileURLToPath(new URL('../out/phones/', import.meta.url))
const WIDTHS = [320, 344, 360, 375, 390, 393, 402, 412, 420, 440, 466, 669, 707, 820]
// The host screen runs on a laptop, a projector or a TV.
const TVS = [[1280, 720], [1500, 1000], [1920, 1080]]
const baseArg = process.argv.slice(2).find((a) => a.startsWith('http'))

const SCREENS = [
  { name: 'builder', path: '/', wait: '[data-build]' },
  { name: 'builder-built', path: '/', act: async (page) => { await page.click('[data-build]'); await page.waitForSelector('[data-open]') }, mockBuild: true },
  { name: 'join', path: '/j/PLMN', wait: 'input[name=nick]', noNick: true, mock: true },
  { name: 'phone-lobby', path: '/j/PLMN', room: roomScript('lobby'), wait: '.phone-big' },
  { name: 'phone-question', path: '/j/PLMN', room: roomScript('question', 0), wait: '.answers' },
  { name: 'phone-reveal', path: '/j/PLMN', room: roomScript('reveal', 0), wait: '.verdict' },
  { name: 'phone-end', path: '/j/PLMN', room: roomScript('end'), wait: '.stat-row' },
  { name: 'host-lobby', path: '/h/PLMN', room: roomScript('lobby'), wait: '.join-code' },
  { name: 'host-question', path: '/h/PLMN', room: roomScript('question', 0), wait: '.tiles' },
  { name: 'host-reveal-first', path: '/h/PLMN', room: roomScript('reveal', 0), wait: '.score-list' },
  { name: 'host-reveal', path: '/h/PLMN', room: roomScript('reveal', 3), wait: '.lens' },
  { name: 'print', path: '/q/demo-fixture-1/print', wait: '.print-sheet' },
]

/** Measures every visible control and the page width; returns the faults found. */
function measure() {
  const faults = []
  const vw = document.documentElement.clientWidth
  const scroller = document.querySelector('.screen') ?? document.documentElement
  if (scroller.scrollWidth > vw + 1) faults.push(`sideways scroll: ${scroller.scrollWidth} px in ${vw} px`)
  const controls = [...document.querySelectorAll('button, a.btn, .chip, input:not([type=checkbox]), .toggle')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]')
  })
  const boxes = controls.map((el) => ({ el, r: el.getBoundingClientRect(), name: (el.innerText || el.getAttribute('aria-label') || el.name || el.tagName).trim().slice(0, 28) }))
  for (const { el, r, name } of boxes) {
    if (r.left < 15.5 || vw - r.right < 15.5) faults.push(`"${name}" is ${Math.round(Math.min(r.left, vw - r.right))} px from the edge`)
    if (r.height < 43.5 && !el.classList.contains('toggle')) faults.push(`"${name}" is ${Math.round(r.height)} px tall`)
    if (el.scrollWidth > el.clientWidth + 1) faults.push(`"${name}" text overflows`)
    const st = getComputedStyle(el)
    if (el.matches('.btn, .chip, .answer') && (parseFloat(st.paddingLeft) < 8 || parseFloat(st.paddingRight) < 8)) faults.push(`"${name}" has under 8 px side padding`)
  }
  // Neighbours: two controls side by side or one above the other, closer than 12 px, or overlapping.
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].r
      const b = boxes[j].r
      if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue
      const gapX = Math.max(b.left - a.right, a.left - b.right)
      const gapY = Math.max(b.top - a.bottom, a.top - b.bottom)
      if (gapX < 0 && gapY < 0) faults.push(`"${boxes[i].name}" overlaps "${boxes[j].name}"`)
      else if ((gapY < 0 && gapX >= 0 && gapX < 11.5) || (gapX < 0 && gapY >= 0 && gapY < 11.5)) {
        faults.push(`"${boxes[i].name}" is ${Math.round(Math.max(gapX, gapY))} px from "${boxes[j].name}"`)
      }
    }
  }
  // A word split across two lines reads as a typo on a TV (the live host reveal, 26 Oct: "Cheerleade" then "r").
  // Links and the build log may break anywhere.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement
    if (!el || el.closest('[hidden], script, style, .log, .log-line, .join-url, .screen-foot')) continue
    for (const m of node.textContent.matchAll(/[\p{L}\p{N}']{2,}/gu)) {
      const range = document.createRange()
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)))
      if (tops.size > 1) faults.push(`"${m[0]}" is split across lines`)
    }
  }
  return faults
}

const server = baseArg ? null : await serve()
const BASE = (baseArg ?? server.url).replace(/\/$/, '')
const browser = await chromium.launch({ headless: true })
const failures = []
let shots = 0
try {
  // Every screen at every phone width, then the host screens at TV sizes.
  const views = [
    ...WIDTHS.flatMap((width) => SCREENS.map((screen) => ({ screen, width, height: Math.round(width * 2.1), dir: `${width}` }))),
    ...TVS.flatMap(([width, height]) => SCREENS.filter((s) => s.path.startsWith('/h/')).map((screen) => ({ screen, width, height, dir: `tv-${width}x${height}` }))),
  ]
  for (const { screen, width, height, dir } of views) {
    mkdirSync(`${OUT}${dir}`, { recursive: true })
    {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: true })
      await context.addInitScript((noNick) => {
        localStorage.setItem('rp-host-PLMN', JSON.stringify({ token: 'fixture-token', quiz: 'demo-fixture-1' }))
        if (!noNick) localStorage.setItem('rp-nick-PLMN', JSON.stringify('Quizzy McQuiz'))
      }, Boolean(screen.noNick))
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      if (!baseArg || screen.mock || screen.room || screen.mockBuild || screen.path.startsWith('/q/')) await mockApi(page, { room: screen.room ?? [] })
      await page.goto(BASE + screen.path)
      if (screen.act) await screen.act(page)
      if (screen.wait) await page.waitForSelector(screen.wait, { timeout: 10_000 })
      await page.waitForTimeout(200)
      const faults = [...(await page.evaluate(measure)), ...errors.map((e) => `script error: ${e}`)]
      await page.screenshot({ path: `${OUT}${dir}/${screen.name}.png`, fullPage: !screen.path.startsWith('/h/') })
      shots += 1
      for (const f of faults) failures.push(`${dir} ${screen.name}: ${f}`)
      await context.close()
    }
  }
} finally {
  await browser.close()
  server?.close()
}
console.log(`${shots} pictures in ${OUT}`)
if (failures.length) {
  console.log(`${failures.length} faults`)
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}
console.log('no faults')
