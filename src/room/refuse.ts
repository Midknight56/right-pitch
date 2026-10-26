/**
 * Says no to a socket in a way a browser can read. A page cannot see the status of a refused upgrade, so it would only
 * retry; instead the socket opens, carries one error message, and closes with 1008, which the pages do not retry.
 * Outside the Workers runtime (the unit tests) there is no socket pair, so it answers with the plain refusal.
 */
export function refuse(text: string, status = 403): Response {
  if (typeof WebSocketPair === 'undefined') return Response.json({ type: 'error', text }, { status })
  const pair = new WebSocketPair()
  const server = pair[1]
  server.accept()
  server.send(JSON.stringify({ type: 'error', text }))
  server.close(1008, text.slice(0, 120))
  return new Response(null, { status: 101, webSocket: pair[0] })
}
