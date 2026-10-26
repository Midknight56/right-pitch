// The phone: a nickname, then four big buttons each question, then how it went.
import { countdown, esc, localEnd, newPid, optionLetter, store } from './lib.js'
import { roomSocket } from './socket.js'

const TILES = ['bg-a', 'bg-b', 'bg-c', 'bg-d']

export async function phoneScreen(app, code) {
  // A code with no room behind it (mistyped, or past its 24 hours) gets a plain answer, not a socket that retries.
  const info = await fetch(`/api/rooms/${encodeURIComponent(code)}`).then((r) => (r.status === 404 ? { exists: false } : r.json())).catch(() => ({ exists: true }))
  if (!info.exists) {
    app.innerHTML = `<div class="top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a></div>
      <div class="phone"><div class="phone-card"><p class="phone-code">${esc(code)}</p><p class="phone-big">No room with that code.</p>
      <a class="btn btn-wide" href="/">Make your own quiz</a></div></div>`
    return
  }
  let pid = store.get('rp-pid')
  if (!pid) {
    pid = newPid()
    store.set('rp-pid', pid)
  }
  const nick = store.get(`rp-nick-${code}`)
  if (nick) return play(app, code, pid, nick)

  app.innerHTML = `<div class="top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a></div>
    <form class="phone" novalidate>
      <div class="phone-card">
        <p class="phone-code">${esc(code)}</p>
        <label class="field"><span class="field-label">Your name on the screen</span>
          <input class="input" name="nick" maxlength="16" autocomplete="nickname" enterkeyhint="go" required></label>
        <button class="btn btn-primary btn-wide" type="submit">Join</button>
        <p class="status-line" role="status" data-status></p>
      </div>
    </form>`
  const form = app.querySelector('form')
  form.nick.focus()
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = form.nick.value.trim()
    if (!/^[\p{L}\p{N} ]{1,16}$/u.test(name)) {
      form.querySelector('[data-status]').textContent = 'Letters, digits and spaces, up to 16.'
      return
    }
    store.set(`rp-nick-${code}`, name)
    play(app, code, pid, name)
  })
}

function play(app, code, pid, nick) {
  const state = { phase: 'waiting', question: null, end: 0, choice: null, locked: false, reveal: null, you: null, top: [], error: '' }
  let tickTimer = null

  app.innerHTML = `<div class="top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a>
      <span class="field-label" data-net>${esc(nick)}</span></div>
    <div class="phone" data-body></div>`
  const body = app.querySelector('[data-body]')
  const net = app.querySelector('[data-net]')

  const socket = roomSocket(code, () => `role=player&nick=${encodeURIComponent(nick)}&pid=${encodeURIComponent(pid)}`, onMessage, (s) => {
    net.textContent = s === 'reconnecting' ? 'Reconnecting' : nick
    if (s === 'refused' && state.phase !== 'error') {
      state.phase = 'error'
      state.error = state.error || 'This room is closed.'
      render()
    }
  })

  body.addEventListener('click', (event) => {
    const b = event.target.closest('[data-choice]')
    if (b && state.phase === 'question' && state.choice === null && countdown(state.end) > 0) {
      state.choice = Number(b.dataset.choice)
      socket.send({ type: 'answer', q: state.question.n, choice: state.choice })
      render()
    }
    if (event.target.closest('[data-rename]')) {
      socket.stop()
      store.set(`rp-nick-${code}`, null)
      phoneScreen(app, code)
    }
  })

  function onMessage(m, receivedAt) {
    if (m.type === 'lobby') {
      if (state.phase === 'waiting' || state.phase === 'connecting') state.phase = 'lobby'
    } else if (m.type === 'question') {
      if (state.question?.n !== m.n) state.choice = null
      state.phase = 'question'
      state.question = m
      state.end = localEnd(m, receivedAt)
      state.locked = false
    } else if (m.type === 'locked') {
      state.locked = true
      if (state.choice === null) state.choice = -1
    } else if (m.type === 'reveal') {
      state.phase = 'reveal'
      state.reveal = m
    } else if (m.type === 'you') {
      state.you = m
    } else if (m.type === 'scores') {
      state.top = m.top
    } else if (m.type === 'end') {
      state.phase = 'end'
      state.top = m.top
    } else if (m.type === 'error') {
      state.phase = 'error'
      state.error = m.text
      // A name the room refused is forgotten, so the next try asks again.
      if (/nickname|full|removed/i.test(m.text)) store.set(`rp-nick-${code}`, null)
    }
    render()
  }

  function render() {
    clearInterval(tickTimer)
    if (state.phase === 'waiting') {
      body.innerHTML = `<div class="phone-card"><p class="phone-big">Joining</p></div>`
    } else if (state.phase === 'lobby') {
      body.innerHTML = `<div class="phone-card"><p class="phone-big">You're in</p><p>Watch the big screen.</p>
        <button class="linkish" type="button" data-rename>Change name</button></div>`
    } else if (state.phase === 'question') {
      const q = state.question
      const picked = state.choice !== null
      body.innerHTML = `
        <div class="timer-bar"><span data-bar></span></div>
        <p class="q-prompt">${esc(q.prompt)}</p>
        <div class="answers ${picked || state.locked ? 'locked' : ''}">${q.options.map((o, i) => `
          <button type="button" class="answer ${TILES[i % 4]}" data-choice="${i}" aria-pressed="${state.choice === i}" ${picked || state.locked ? 'disabled' : ''}>
            <span class="tile-letter">${optionLetter(i)}</span><span>${esc(o)}</span>
          </button>`).join('')}
        </div>
        ${picked && state.choice >= 0 ? '<p class="status-line">Locked in</p>' : ''}`
      const total = typeof q.now === 'number' ? Math.max(1000, q.endsAt - q.now) : 20000
      const tick = () => {
        const bar = body.querySelector('[data-bar]')
        if (!bar) return
        const left = Math.max(0, state.end - Date.now())
        bar.style.width = `${Math.min(100, (left / total) * 100)}%`
      }
      tick()
      tickTimer = setInterval(tick, 250)
    } else if (state.phase === 'reveal') {
      const r = state.reveal
      const you = state.you
      // After a reconnect the phone has lost its pick; the room's own record of it wins.
      const mine = you?.last?.n === r.n ? you.last : null
      const right = mine ? mine.right : state.choice === r.answer
      const missed = !mine && (state.choice === null || state.choice < 0)
      body.innerHTML = `<div class="phone-card">
          <p class="verdict ${right ? 'verdict-good' : 'verdict-bad'}">${right ? 'Right' : missed ? 'Too slow' : 'Not this time'}</p>
          ${right ? '' : `<p>${esc(optionLetter(r.answer))}: ${esc(state.question?.options[r.answer] ?? '')}</p>`}
          ${you ? `<div class="stat-row"><span><strong>${you.score}</strong>points</span><span><strong>${ordinal(you.rank)}</strong>place</span></div>` : ''}
        </div>`
    } else if (state.phase === 'end') {
      const you = state.you
      body.innerHTML = `<div class="phone-card">
          <p class="phone-big">${you?.rank === 1 ? 'You won' : 'That is the lot'}</p>
          ${you ? `<div class="stat-row"><span><strong>${you.score}</strong>points</span><span><strong>${ordinal(you.rank)}</strong>place</span></div>` : ''}
          <a class="btn btn-wide" href="/">Make your own quiz</a>
        </div>`
    } else if (state.phase === 'error') {
      body.innerHTML = `<div class="phone-card"><p class="phone-big">${esc(state.error)}</p>
        <a class="btn btn-primary btn-wide" href="/j/${esc(code)}">Try again</a></div>`
    }
  }

  render()
}

function ordinal(n) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
  return `${n}${tail}`
}
