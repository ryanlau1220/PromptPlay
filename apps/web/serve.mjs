import { resolve, sep } from 'node:path'
import app from './dist/server/server.js'

const assets = resolve(import.meta.dirname, 'dist/client')
const server = Bun.serve({
  hostname: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/assets/') || path.startsWith('/hands/') || ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/push-worker.js'].includes(path)) {
      const filePath = resolve(assets, `.${path}`)
      if (!filePath.startsWith(`${assets}${sep}`)) return new Response('Not found', { status: 404 })
      const file = Bun.file(filePath)
      if (await file.exists()) {
        const cacheControl = path.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : path === '/push-worker.js'
            ? 'no-cache'
            : 'public, max-age=3600'
        return new Response(file, { headers: { 'cache-control': cacheControl } })
      }
      return new Response('Not found', { status: 404 })
    }
    return app.fetch(request)
  },
})
console.log(`PromptPlay web listening on ${server.port}`)
