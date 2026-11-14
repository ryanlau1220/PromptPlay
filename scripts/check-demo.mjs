import assert from 'node:assert/strict'

const [webUrl, apiUrl] = process.argv.slice(2)
if (!webUrl || !apiUrl) {
  console.error('Usage: bun scripts/check-demo.mjs WEB_URL API_URL')
  process.exit(2)
}
const web = new URL(webUrl)
const api = new URL(apiUrl)
const get = (url, headers) => fetch(url, { headers, signal: AbortSignal.timeout(10000) })
const [page, health, config] = await Promise.all([
  get(web),
  get(new URL('/health', api)),
  get(new URL('/config', api), { Origin: web.origin })
])
assert.ok(page.ok, `Web HTTP ${page.status}`)
assert.match(await page.text(), /PromptPlay/i)
assert.ok(health.ok && (await health.json()).ok, 'API health check failed')
assert.ok(config.ok, `API config HTTP ${config.status}`)
assert.ok([web.origin, '*'].includes(config.headers.get('access-control-allow-origin')), 'API did not allow the web origin')
const settings = await config.json()
assert.equal(settings.network, 'testnet')
const socketUrl = new URL('/rooms/0/ws', api)
socketUrl.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:'
await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl, { headers: { Origin: web.origin } })
  const timer = setTimeout(() => finish(new Error('No room resync event within 10 seconds')), 10000)
  function finish(error) {
    clearTimeout(timer)
    socket.close()
    if (error) reject(error)
    else resolve()
  }
  socket.addEventListener('message', event => {
    if (JSON.parse(String(event.data)).type === 'resync_required') finish()
  })
  socket.addEventListener('error', () => finish(new Error('Room WebSocket connection failed')))
})
console.log(JSON.stringify({
  web: web.origin,
  api: api.origin,
  network: settings.network,
  webSocket: 'resync received',
  faucetAvailable: settings.faucetAvailable,
  redemptionAvailable: settings.redemptionAvailable,
  redemptionUnitsAvailable: settings.redemptionUnitsAvailable,
  configuredModel: settings.model,
  liveInferenceVerified: false
}, null, 2))
