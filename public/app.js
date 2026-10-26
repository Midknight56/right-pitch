// The one page: it picks a screen from the path.
//   /            the builder (builder.js)
//   /h/<CODE>    the host screen (host.js)
//   /j/<CODE>    the phone (phone.js)
//   /q/<id>/print the printable sheet (print.js)
import { esc } from './lib.js'

const app = document.querySelector('#app')
const path = location.pathname.replace(/\/$/, '') || '/'

function notFound(text) {
  app.innerHTML = `<div class="top"><a class="brand" href="/"><span class="brand-mark">?</span>Right Pitch</a></div>
    <p class="empty">${esc(text)}</p>`
}

async function route() {
  if (path === '/') {
    const { builder } = await import('./builder.js')
    return builder(app)
  }
  const host = path.match(/^\/h\/([A-Z]{4})$/)
  if (host) {
    const { hostScreen } = await import('./host.js')
    return hostScreen(app, host[1])
  }
  const phone = path.match(/^\/j\/([A-Z]{4})$/)
  if (phone) {
    const { phoneScreen } = await import('./phone.js')
    return phoneScreen(app, phone[1])
  }
  const sheet = path.match(/^\/q\/([A-Za-z0-9_-]{6,48})\/print$/)
  if (sheet) {
    const { printSheet } = await import('./print.js')
    return printSheet(app, sheet[1])
  }
  notFound('Nothing here.')
}

route().catch(() => notFound('Something broke. Reload the page.'))
