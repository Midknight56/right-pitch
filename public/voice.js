// The host's voice. A line plays its recorded file from /voice/ when one exists, else the browser speaks it.
// The words are the 40 stock lines; nothing a visitor types is ever spoken.

const LINES = {
  open: 'Evening all. Grab your phones and scan the code.',
  first: 'First one in. Love that.',
  start: 'Right. Phones up. Here we go.',
  round1: 'Round one.', round2: 'Round two.', round3: 'Round three.', round4: 'Final round.',
  film: 'Films. Get your popcorn brains on.',
  telly: 'Telly. Sofa knowledge counts.',
  books: 'Books. Shelf of fame time.',
  faces: 'Famous faces. Who came first?',
  music: 'Music. Hum it if you have to.',
  generation: 'The generation game. Young or old, who leans to it?',
  local: 'The local round. Home advantage.',
  ten: 'Ten seconds.',
  locked: 'Pens down.',
  most: 'Most of you got that. Nice.',
  few: 'Ooh. That one caught a few of you out.',
  nobody: 'Nobody. Not one of you. Brilliant.',
  everyone: 'Every single one of you. Too easy?',
  half: 'Half time. Get a round in.',
  lastq: 'Final question of the night.',
  end: "That's the lot.",
  winner: 'And our winner is up there. Take a bow.',
}

export function voice() {
  let on = false
  let audio = null
  return {
    get on() { return on },
    set(value) {
      on = value
      if (!on) stop()
    },
    say(id) {
      if (!on || !LINES[id]) return
      stop()
      let spoken = false
      const fallback = () => {
        if (spoken) return
        spoken = true
        speak(LINES[id])
      }
      audio = new Audio(`/voice/${id}.mp3`)
      audio.onerror = fallback
      audio.play().catch(fallback)
    },
  }
  function stop() {
    if (audio) { audio.onerror = null; audio.pause(); audio = null }
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return
  const line = new SpeechSynthesisUtterance(text)
  line.rate = 1.02
  speechSynthesis.speak(line)
}
