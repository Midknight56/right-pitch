// The builder: the host sets up the night, watches the build, checks each answer, then opens the room.
import { AGES } from './words.js'
import {
  BUILD_KINDS, KIND_WORDS, LEVEL_WORDS, ageWords, createNdjsonSplitter, describeCall, esc, fieldLabel, meterSpot, optionLetter, pct, store,
} from './lib.js'

const KINDS = BUILD_KINDS
const TILES = ['bg-a', 'bg-b', 'bg-c', 'bg-d']
const FALLBACK = { town: '', crowd: ['30_to_34', '35_to_44'], difficulty: 'mixed', rounds: ['film', 'music', 'generation', 'local'] }

export async function builder(app) {
  const presets = await fetch('/api/presets').then((r) => (r.ok ? r.json() : [])).catch(() => [])
  const setup = { seeds: [], ...structuredClone(presets[0]?.setup ?? FALLBACK) }
  let quiz = null
  let busy = false

  app.innerHTML = `
    <div class="top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a></div>
    <div class="builder">
      <form class="panel setup" novalidate>
        <h1 class="lede">A quiz pitched at the room you are in.</h1>
        <fieldset><legend class="field-label">Start from</legend><div class="chips" data-presets></div></fieldset>
        <label class="field"><span class="field-label">Town</span><input class="input" name="town" maxlength="40" autocomplete="off" required></label>
        <fieldset><legend class="field-label">Who is in</legend><div class="chips" data-crowd></div></fieldset>
        <fieldset><legend class="field-label">How hard</legend><div class="chips" data-difficulty></div></fieldset>
        <fieldset><legend class="field-label">Four rounds</legend><div class="chips" data-rounds></div></fieldset>
        <label class="field"><span class="field-label">Local names, up to 3</span><input class="input" name="seeds" maxlength="120" placeholder="Home team, local band" autocomplete="off"></label>
        <button class="btn btn-primary btn-wide" type="submit" data-build>Build the quiz</button>
        <p class="status-line" data-status role="status"></p>
      </form>
      <section class="results" data-results aria-label="The quiz">
        <p class="empty">Your rounds show up here as they are built.</p>
      </section>
    </div>`

  const form = app.querySelector('form')
  const status = app.querySelector('[data-status]')
  const results = app.querySelector('[data-results]')
  const buildButton = app.querySelector('[data-build]')

  app.querySelector('[data-presets]').innerHTML = presets
    .map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.name)}</button>`).join('')
  app.querySelector('[data-difficulty]').innerHTML = ['easy', 'mixed', 'hard']
    .map((d) => `<button type="button" class="chip" data-difficulty-value="${d}">${d[0].toUpperCase()}${d.slice(1)}</button>`).join('')
  app.querySelector('[data-crowd]').innerHTML = AGES
    .map((a) => `<button type="button" class="chip" data-age="${a}">${esc(ageWords(a))}</button>`).join('')
  app.querySelector('[data-rounds]').innerHTML = KINDS
    .map((k) => `<button type="button" class="chip" data-kind="${k}">${esc(KIND_WORDS[k])}</button>`).join('')

  const paint = () => {
    form.town.value = setup.town
    form.seeds.value = (setup.seeds ?? []).join(', ')
    for (const b of form.querySelectorAll('[data-age]')) b.setAttribute('aria-pressed', String(setup.crowd.includes(b.dataset.age)))
    for (const b of form.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(setup.rounds.includes(b.dataset.kind)))
    for (const b of form.querySelectorAll('[data-difficulty-value]')) b.setAttribute('aria-pressed', String(setup.difficulty === b.dataset.difficultyValue))
  }
  paint()

  form.addEventListener('click', (event) => {
    const b = event.target.closest('button[type="button"]')
    if (!b || busy) return
    if (b.dataset.preset) Object.assign(setup, { seeds: [] }, structuredClone(presets[Number(b.dataset.preset)].setup))
    if (b.dataset.age) setup.crowd = toggle(setup.crowd, b.dataset.age)
    if (b.dataset.difficultyValue) setup.difficulty = b.dataset.difficultyValue
    if (b.dataset.kind) {
      // Four rounds exactly: a fifth pick drops the oldest one.
      setup.rounds = setup.rounds.includes(b.dataset.kind)
        ? setup.rounds.filter((k) => k !== b.dataset.kind)
        : [...setup.rounds, b.dataset.kind].slice(-4)
    }
    paint()
  })
  form.town.addEventListener('input', () => { setup.town = form.town.value })
  form.seeds.addEventListener('input', () => {
    setup.seeds = form.seeds.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3)
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    const problem = check(setup)
    status.textContent = problem
    if (problem) return
    busy = true
    buildButton.disabled = true
    status.textContent = 'Building'
    quiz = null
    try {
      await build(structuredClone(setup))
    } finally {
      busy = false
      buildButton.disabled = false
    }
  })

  async function build(body) {
    if (!body.seeds?.length) delete body.seeds
    results.innerHTML = `<div class="summary"><div class="summary-facts" data-facts></div><div class="actions" data-actions></div></div>
      <div class="log" data-log aria-label="Build log"></div><div class="results" data-rounds-out></div>`
    const log = results.querySelector('[data-log]')
    const roundsOut = results.querySelector('[data-rounds-out]')
    const facts = results.querySelector('[data-facts]')
    let stopped = false
    const line = (text, kind = '') => {
      log.insertAdjacentHTML('beforeend', `<div class="log-line ${kind}">${esc(text)}</div>`)
      log.scrollTop = log.scrollHeight
    }

    let response
    try {
      response = await fetch('/api/build', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setup: body }),
      })
    } catch {
      status.textContent = 'No connection. Try again.'
      return
    }
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}))
      status.textContent = error.error ?? 'The build did not start. Try again.'
      line(status.textContent, 'log-drop')
      return
    }

    const onEvent = (e) => {
      if (e.t === 'start') line(e.mode === 'live' ? 'Asking Qloo about your crowd' : `Using a ${e.mode} build`)
      else if (e.t === 'plan') line(`Planned ${e.rounds.length} rounds${e.by === 'template' ? ' from the house plan' : ''}`)
      else if (e.t === 'call') line(describeCall(e))
      else if (e.t === 'question') {
        line(e.ok ? `Round ${e.round + 1}, question ${e.index + 1} checked` : `Dropped a question: ${e.why ?? 'not good enough'}`, e.ok ? 'log-ok' : 'log-drop')
      } else if (e.t === 'replan') line(`Round ${e.round + 1} changed: ${e.why}`, 'log-drop')
      else if (e.t === 'round') roundsOut.insertAdjacentHTML('beforeend', roundCard(e.round, e.index))
      else if (e.t === 'usage') facts.innerHTML = `<span>${e.qloo} Qloo calls</span>`
      else if (e.t === 'error') {
        stopped = true
        status.textContent = `Stopped: ${e.text}`
        line(e.text, 'log-drop')
      } else if (e.t === 'done') done(e.quiz)
    }
    const splitter = createNdjsonSplitter(onEvent)
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    try {
      for (;;) {
        const { value, done: finished } = await reader.read()
        if (finished) break
        splitter.push(value)
      }
      splitter.end()
    } catch {
      line('The connection dropped.', 'log-drop')
    }
    if (!quiz && !stopped) status.textContent = 'The build stopped early. Try again.'

    function done(built) {
      quiz = built
      store.set('rp-last-quiz', built.id)
      const n = built.rounds.reduce((sum, r) => sum + r.questions.length, 0)
      status.textContent = `${n} questions ready`
      facts.innerHTML = `<span>${n} questions</span><span>${built.qlooCalls} Qloo calls</span>${built.mode === 'live' ? '' : `<span>${esc(built.mode)} build</span>`}`
      results.querySelector('[data-actions]').innerHTML = `
        <a class="btn" href="/q/${encodeURIComponent(built.id)}/print">Print</a>
        <button class="btn btn-primary" type="button" data-open>Open the room</button>`
    }
  }

  results.addEventListener('click', (event) => {
    const tick = event.target.closest('[data-record]')
    if (tick) return showRecord(JSON.parse(tick.dataset.record))
    const report = event.target.closest('[data-report]')
    if (report && quiz) return sendReport(report)
    const open = event.target.closest('[data-open]')
    if (open && quiz) return openRoom(open)
  })

  async function openRoom(button) {
    button.disabled = true
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quiz: quiz.id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.code) throw new Error(body.error ?? 'The room did not open. Try again.')
      store.set(`rp-host-${body.code}`, { token: body.hostToken, quiz: quiz.id })
      location.assign(`/h/${body.code}`)
    } catch (error) {
      status.textContent = error.message
      button.disabled = false
    }
  }

  async function sendReport(button) {
    const why = prompt('What is wrong with this one?')
    if (!why) return
    const response = await fetch('/api/report', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quiz: quiz.id, question: button.dataset.report, why: why.slice(0, 300) }),
    }).catch(() => null)
    button.textContent = response?.ok ? 'Thanks' : 'Not sent'
    button.disabled = true
  }
}

export function check(setup) {
  if (!setup.town.trim()) return 'Type a town.'
  if (!/^[\p{L} .',-]+$/u.test(setup.town)) return 'A town is letters only, like Glasgow, Scotland.'
  if (setup.town.trim().length > 40) return 'Keep the town to 40 letters or fewer.'
  if (setup.seeds?.some((seed) => seed.length > 40)) return 'Keep each local name to 40 letters or fewer.'
  if (!setup.crowd.length) return 'Pick who is in.'
  const left = 4 - setup.rounds.length
  if (left) return `Pick ${left} more round${left === 1 ? '' : 's'}.`
  return ''
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function roundCard(round, index) {
  const m = round.meter
  return `<article class="round">
    <div class="round-head">
      <p class="round-kicker">Round ${index + 1}, ${esc(LEVEL_WORDS[round.level] ?? round.level)}</p>
      <h2 class="round-title">${esc(round.title)}</h2>
      ${round.banter ? `<p class="round-banter">${esc(round.banter)}</p>` : ''}
    </div>
    <div class="meter">
      <div class="meter-track" role="img" aria-label="How well known: ${pct(m.mean)} on average">
        <span class="meter-band" style="left:${meterSpot(m.band.min)}%;right:${100 - meterSpot(m.band.max)}%"></span>
        <span class="meter-spread" style="left:${meterSpot(m.min)}%;right:${100 - meterSpot(m.max)}%"></span>
        <span class="meter-mean" style="left:${meterSpot(m.mean)}%"></span>
      </div>
      <div class="meter-words"><span>Deep cut</span><span>Average ${pct(m.mean)}</span><span>Everyone knows</span></div>
    </div>
    ${round.questions.map(questionRow).join('')}
  </article>`
}

function questionRow(q) {
  return `<div class="q">
    <p class="q-prompt">${esc(q.prompt)}</p>
    <div class="opts">${q.options.map((o, i) => `
      <div class="opt ${i === q.answer ? 'opt-right' : ''}">
        <span class="opt-letter ${TILES[i % 4]}">${optionLetter(i)}</span>
        <span class="opt-text">${esc(o.label)}</span>
        ${o.record ? `<button type="button" class="tick" data-record="${esc(JSON.stringify(o.record))}" aria-label="The record for ${esc(o.label)}">${i === q.answer ? '✓' : 'i'}</button>` : ''}
      </div>`).join('')}
    </div>
    ${q.lens ? lensBars(q.lens) : ''}
    <div class="q-foot"><span>${esc(q.reveal)}</span><button type="button" class="linkish" data-report="${esc(q.id)}">Wrong?</button></div>
  </div>`
}

export function lensBars(lens) {
  const row = (label, v) => `<div class="lens-row"><span>${label}</span><span class="lens-bar"><span style="width:${Math.round(v * 100)}%"></span></span><span>${pct(v)}</span></div>`
  return `<div class="lens">${row('24 and under', lens.young)}${row('55 and over', lens.old)}</div>`
}

function showRecord(record) {
  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Qloo record">
    <div class="sheet-head"><h2 class="round-title">${esc(record.name)}</h2><button class="btn" type="button" data-close>Close</button></div>
    <dl class="facts">
      <dt>Type</dt><dd>${esc(String(record.type).replace('urn:entity:', '').split('_').join(' '))}</dd>
      <dt>Popularity</dt><dd>${pct(record.popularity)}</dd>
      <dt>${esc(fieldLabel(record.field))}</dt><dd>${esc(record.value)}</dd>
      <dt>Qloo id</dt><dd>${esc(record.qlooId)}</dd>
    </dl></div>`
  const onKey = (e) => { if (e.key === 'Escape') close() }
  const close = () => {
    sheet.remove()
    document.removeEventListener('keydown', onKey)
  }
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) close() })
  document.addEventListener('keydown', onKey)
  document.body.append(sheet)
  sheet.querySelector('[data-close]').focus()
}
