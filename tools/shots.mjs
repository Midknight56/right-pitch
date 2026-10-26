// Pictures of every screen against the stand in server (tools/mock.mjs), once per palette in public/palettes/.
// Headless, one browser. Run it through the shared browser lock:
//   python A:/Projects/shipatonv2/tools/pw_lock.py run right-pitch -- node tools/shots.mjs [palette ...]
// Pictures go to out/shots/<palette>/<screen>.png.
import { mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { mockApi, roomScript, serve } from './mock.mjs'

const PALETTES = fileURLToPath(new URL('../public/palettes/', import.meta.url))
const OUT = fileURLToPath(new URL('../out/shots/', import.meta.url))
const wanted = process.argv.slice(2)
const palettes = readdirSync(PALETTES).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).filter((p) => !wanted.length || wanted.includes(p))

const SCREENS = [
  { name: 'builder', path: '/', size: [1280, 900], act: async (page) => { await page.click('[data-build]'); await page.waitForSelector('[data-open]') } },
  { name: 'host-lobby', path: '/h/PLMN', size: [1280, 720], room: roomScript('lobby'), wait: '.join-code' },
  { name: 'host-question', path: '/h/PLMN', size: [1280, 720], room: roomScript('question', 0), wait: '.tiles' },
  { name: 'host-reveal', path: '/h/PLMN', size: [1280, 720], room: roomScript('reveal', 0), wait: '.score-list' },
  { name: 'host-lens', path: '/h/PLMN', size: [1280, 720], room: roomScript('reveal', 3), wait: '.lens' },
  { name: 'phone-question', path: '/j/PLMN', size: [390, 844], room: roomScript('question', 0), wait: '.answers' },
  { name: 'phone-reveal', path: '/j/PLMN', size: [390, 844], room: roomScript('reveal', 0), wait: '.verdict' },
]

const server = await serve()
const browser = await chromium.launch({ headless: true })
try {
  for (const palette of palettes) {
    mkdirSync(`${OUT}${palette}`, { recursive: true })
    for (const screen of SCREENS) {
      const context = await browser.newContext({ viewport: { width: screen.size[0], height: screen.size[1] }, deviceScaleFactor: 1 })
      await context.addInitScript(() => {
        localStorage.setItem('rp-host-PLMN', JSON.stringify({ token: 'fixture-token', quiz: 'demo-fixture-1' }))
        localStorage.setItem('rp-nick-PLMN', JSON.stringify('Priya'))
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await mockApi(page, { room: screen.room ?? [], palette: `${PALETTES}${palette}.css` })
      await page.goto(server.url + screen.path)
      if (screen.act) await screen.act(page)
      if (screen.wait) await page.waitForSelector(screen.wait, { timeout: 8000 })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}${palette}/${screen.name}.png`, fullPage: screen.name === 'builder' })
      if (errors.length) console.log(`${palette} ${screen.name}: page error: ${errors.join(' | ')}`)
      await context.close()
    }
    console.log(`${palette}: ${SCREENS.length} pictures`)
  }
} finally {
  await browser.close()
  server.close()
}
