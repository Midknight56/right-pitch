// The printable sheet: every question with its options, and the answers on the last page.
import { esc, optionLetter } from './lib.js'

export async function printSheet(app, id) {
  const quiz = await fetch(`/api/quiz/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const top = `<div class="top no-print"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">?</span>Right Pitch</a>
    ${quiz ? '<button class="btn btn-primary" type="button" data-print>Print</button>' : ''}</div>`
  if (!quiz) {
    app.innerHTML = `${top}<p class="empty">This quiz is gone. Build a new one.</p>`
    return
  }
  let n = 0
  const numbered = quiz.rounds.map((round) => ({ round, questions: round.questions.map((q) => ({ q, n: ++n })) }))
  app.innerHTML = `${top}<div class="print-sheet">
    <h1 class="lede">${esc(quiz.setup.town)}${quiz.setup.night ? `, ${esc(quiz.setup.night)}` : ''}</h1>
    ${numbered.map(({ round, questions }, i) => `<section class="round"><div class="round-head">
        <p class="round-kicker">Round ${i + 1}</p><h2 class="round-title">${esc(round.title)}</h2></div>
        ${questions.map(({ q, n: k }) => `<div class="q"><p class="q-prompt">${k}. ${esc(q.prompt)}</p>
          <ol type="A">${q.options.map((o) => `<li>${esc(o.label)}</li>`).join('')}</ol></div>`).join('')}
      </section>`).join('')}
    <section class="round" style="break-before:page"><div class="round-head"><h2 class="round-title">Answers</h2></div>
      ${numbered.map(({ questions }) => questions.map(({ q, n: k }) => `<div class="q"><p>${k}. ${optionLetter(q.answer)}, ${esc(q.options[q.answer]?.label ?? '')}. ${esc(q.reveal)}</p></div>`).join('')).join('')}
    </section>
  </div>`
  app.querySelector('[data-print]').addEventListener('click', () => window.print())
}
