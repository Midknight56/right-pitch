// The host screen: the telly in the pub. QR code and lobby, then each question, the reveal and the scores.
import { KIND_WORDS, countdown, esc, localEnd, optionLetter, store } from './lib.js'
import { qrSvg } from './qr.js'
import { roomSocket } from './socket.js'
import { lensBars } from './builder.js'
import { voice } from './voice.js'

const TILES = ['bg-a', 'bg-b', 'bg-c', 'bg-d']

export async function hostScreen(app, code) {
  const saved = store.get(`rp-host-${code}`)
  const joinUrl = `${location.origin}/j/${code}`
  if (!saved?.token) {
    // Not the screen that opened the room: send this visitor to the phone page instead of a dead end.
    app.innerHTML = `<div class="top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a></div>
      <div class="phone"><div class="phone-card"><p class="phone-big">This is the host's screen.</p>
      <a class="btn btn-primary btn-wide" href="/j/${code}">Play on this phone</a></div></div>`
    return
  }

  const quiz = await fetch(`/api/quiz/${encodeURIComponent(saved.quiz)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const roundOf = (title) => Math.max(0, quiz?.rounds.findIndex((r) => r.title === title) ?? 0)
  const lastInRound = (n) => {
    let count = 0
    for (const r of quiz?.rounds ?? []) {
      count += r.questions.length
      if (n === count - 1) return true
    }
    return false
  }

  const speaker = voice()
  const state = { phase: 'connecting', players: [], question: null, end: 0, reveal: null, top: [], answered: 0, lastRound: '' }
  let tickTimer = null
  let warned = -1

  document.body.style.overflow = 'hidden'
  app.className = ''
  app.innerHTML = `<div class="screen" data-screen><div class="screen-inner">
      <div class="screen-top">
        <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a>
        <span class="screen-tag" data-tag></span>
      </div>
      <div class="stage" data-stage></div>
      <div class="screen-foot">
        <span data-foot>${esc(joinUrl.replace(/^https?:\/\//, ''))}</span>
        <div class="screen-row">
          <label class="toggle"><input type="checkbox" data-voice> Voice</label>
          <button class="btn btn-primary" type="button" data-go hidden></button>
        </div>
      </div>
    </div></div>`
  const screen = app.querySelector('[data-screen]')
  const stage = app.querySelector('[data-stage]')
  const tag = app.querySelector('[data-tag]')
  const go = app.querySelector('[data-go]')

  app.querySelector('[data-voice]').addEventListener('change', (e) => {
    speaker.set(e.target.checked)
    if (e.target.checked && state.phase === 'lobby') speaker.say('open')
  })

  const socket = roomSocket(code, () => `role=host&token=${encodeURIComponent(saved.token)}`, onMessage, (s) => {
    if (s === 'reconnecting') tag.textContent = 'Reconnecting'
    if (s === 'open' && tag.textContent === 'Reconnecting') tag.textContent = ''
    if (s === 'refused') {
      state.phase = 'gone'
      render()
    }
  })

  go.addEventListener('click', () => {
    if (state.phase === 'lobby') socket.send({ type: 'start' })
    else if (state.phase === 'reveal') socket.send({ type: 'next' })
    else if (state.phase === 'end') location.assign('/')
  })

  function onMessage(m, receivedAt) {
    if (m.type === 'lobby') {
      if (state.phase === 'lobby' && m.players.length === 1 && state.players.length === 0) speaker.say('first')
      state.players = m.players
      if (state.phase === 'connecting') state.phase = 'lobby'
    } else if (m.type === 'question') {
      const newRound = m.round !== state.lastRound
      state.phase = 'question'
      state.question = m
      state.end = localEnd(m, receivedAt)
      state.length = typeof m.now === 'number' ? Math.max(1000, m.endsAt - m.now) : 20000
      state.answered = 0
      state.reveal = null
      if (newRound) {
        state.lastRound = m.round
        const r = roundOf(m.round)
        speaker.say(m.n === 0 ? 'start' : `round${Math.min(4, r + 1)}`)
        if (m.kind) setTimeout(() => speaker.say(m.kind), m.n === 0 ? 1800 : 1200)
      } else if (m.n === m.of - 1) speaker.say('lastq')
    } else if (m.type === 'locked') {
      state.answered = m.answered
      if (state.phase === 'question') speaker.say('locked')
    } else if (m.type === 'reveal') {
      state.phase = 'reveal'
      state.reveal = m
      sayReveal(m)
    } else if (m.type === 'scores') {
      state.top = m.top
    } else if (m.type === 'end') {
      state.phase = 'end'
      state.top = m.top
      speaker.say('winner')
    } else if (m.type === 'error') {
      state.error = m.text
      tag.textContent = m.text
      return
    }
    render()
  }

  function sayReveal(m) {
    const total = m.counts.reduce((a, b) => a + b, 0)
    if (!total) return
    const share = m.counts[m.answer] / total
    const line = share === 1 ? 'everyone' : share === 0 ? 'nobody' : share >= 0.5 ? 'most' : 'few'
    speaker.say(lastInRound(m.n) && roundOf(state.lastRound) === 1 ? 'half' : line)
  }

  function render() {
    clearInterval(tickTimer)
    const kind = state.phase === 'question' || state.phase === 'reveal' ? state.question?.kind : 'lobby'
    screen.style.backgroundImage = kind ? `url(/art/${kind}.webp)` : ''
    go.hidden = !['lobby', 'reveal', 'end'].includes(state.phase)
    // The lobby shows the join link big; the foot repeats it only once the game is on.
    app.querySelector('[data-foot]').hidden = state.phase === 'lobby'

    if (state.phase === 'connecting') {
      stage.innerHTML = `<p class="prompt">Opening the room</p>`
    } else if (state.phase === 'gone') {
      tag.textContent = ''
      stage.innerHTML = `<p class="prompt">${esc(state.error || 'This room has closed.')}</p><a class="btn btn-primary" href="/">Build another</a>`
    } else if (state.phase === 'lobby') {
      tag.textContent = `${state.players.length} in`
      go.textContent = 'Start'
      go.disabled = state.players.length === 0
      stage.innerHTML = `<div class="lobby">
          <div class="qr-box">${qrSvg(joinUrl)}</div>
          <div class="join-words">
            <p class="join-url">${esc(joinUrl.replace(/^https?:\/\//, ''))}</p>
            <p class="join-code">${esc(code)}</p>
            <div class="players">${state.players.map((p) => `<span class="player" ${p.connected === false ? 'style="opacity:.5"' : ''}>${esc(p.nick)}</span>`).join('')}</div>
          </div>
        </div>`
    } else if (state.phase === 'question') {
      const q = state.question
      tag.textContent = `${KIND_WORDS[q.kind] ?? q.round}, ${q.n + 1} of ${q.of}`
      stage.innerHTML = `
        <p class="prompt">${esc(q.prompt)}</p>
        <div class="tiles">${q.options.map((o, i) => tile(o, i)).join('')}</div>
        <div class="screen-row"><span class="timer" data-timer></span><div class="timer-bar" style="flex:1"><span data-bar></span></div></div>`
      const tick = () => {
        const left = countdown(state.end)
        const timer = stage.querySelector('[data-timer]')
        if (!timer) return
        timer.textContent = String(left)
        stage.querySelector('[data-bar]').style.width = `${Math.min(100, ((left * 1000) / state.length) * 100)}%`
        if (left === 10 && warned !== q.n) {
          warned = q.n
          speaker.say('ten')
        }
      }
      tick()
      tickTimer = setInterval(tick, 250)
    } else if (state.phase === 'reveal') {
      const q = state.question
      const r = state.reveal
      const total = Math.max(1, r.counts.reduce((a, b) => a + b, 0))
      tag.textContent = `${KIND_WORDS[q?.kind] ?? ''}, ${r.n + 1} of ${q?.of ?? ''}`
      go.textContent = r.n + 1 >= (q?.of ?? 0) ? 'Final scores' : 'Next'
      stage.innerHTML = `<div class="split">
          <div class="stage">
            <p class="prompt">${esc(q?.prompt ?? '')}</p>
            <div class="tiles">${(q?.options ?? []).map((o, i) => tile(o, i, { count: r.counts[i] ?? 0, share: (r.counts[i] ?? 0) / total, right: i === r.answer })).join('')}</div>
            ${r.lens ? lensBars(r.lens) : ''}
            <p class="reveal-line">${esc(r.reveal)}</p>
          </div>
          ${scoreList(state.top.slice(0, 5))}
        </div>`
    } else if (state.phase === 'end') {
      tag.textContent = 'Final scores'
      go.textContent = 'Build another'
      const winner = state.top[0]
      stage.innerHTML = `${winner ? `<p class="podium">${esc(winner.nick)}</p>` : '<p class="podium">No players</p>'}${scoreList(state.top)}`
    }
  }
}

function tile(label, i, reveal) {
  const classes = ['tile', TILES[i % 4]]
  if (reveal) classes.push(reveal.right ? 'tile-right' : 'tile-dim')
  return `<div class="${classes.join(' ')}">
    ${reveal ? `<span class="tile-fill" style="width:${Math.round(reveal.share * 100)}%"></span>` : ''}
    <span class="tile-letter">${optionLetter(i)}</span>
    <span class="tile-text">${esc(label)}</span>
    ${reveal ? `<span class="tile-count">${reveal.count}</span>` : ''}
  </div>`
}

function scoreList(top) {
  if (!top.length) return ''
  return `<ol class="score-list">${top.map((p, i) => `<li class="score-row"><span class="rank">${i + 1}</span><span class="nick">${esc(p.nick)}</span><span>${p.score}</span></li>`).join('')}</ol>`
}
