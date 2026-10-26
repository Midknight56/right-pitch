// One room socket that reconnects by itself: 1, 2, 4, then every 8 seconds. The room sends the current state on every
// open, so a phone or a host screen that drops comes back where it was.

export function roomSocket(code, query, onMessage, onState) {
  let attempts = 0
  let socket = null
  let stopped = false
  let timer = null

  const url = () => {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${scheme}//${location.host}/api/rooms/${encodeURIComponent(code)}/socket?${query()}`
  }

  const open = () => {
    if (stopped) return
    socket = new WebSocket(url())
    socket.onopen = () => {
      attempts = 0
      onState('open')
    }
    socket.onmessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      onMessage(message, Date.now())
    }
    socket.onclose = (event) => {
      // 1008 is the room saying no (removed, full, too many messages): trying again would only repeat it.
      if (stopped || event.code === 1008) {
        onState(event.code === 1008 ? 'refused' : 'closed')
        return
      }
      onState('reconnecting')
      const wait = [1000, 2000, 4000, 8000][Math.min(attempts, 3)]
      attempts += 1
      timer = setTimeout(open, wait)
    }
    socket.onerror = () => socket.close()
  }

  open()
  return {
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      if (socket) socket.close()
    },
  }
}
