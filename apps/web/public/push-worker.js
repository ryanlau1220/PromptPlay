self.addEventListener('push', event => {
  let data
  try { data = event.data.json() } catch { return }
  if (!/^\d{1,20}$/.test(data.matchId) || !['Completed','Cancelled'].includes(data.phase)) return
  const body = data.phase === 'Cancelled' ? 'Your match was cancelled. Check your refund.' : data.winner ? `${data.winner} won the match.` : 'Your match is complete.'
  event.waitUntil(self.registration.showNotification('PromptPlay match resolved', { body, icon: '/favicon-32.png', tag: `match-${data.matchId}`, data: { matchId: data.matchId } }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL(`/?match=${encodeURIComponent(event.notification.data.matchId)}#play`, self.location.origin).href
  event.waitUntil(clients.openWindow(url))
})
