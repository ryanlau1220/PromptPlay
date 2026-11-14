import app from '@tanstack/react-start/server-entry'

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/health' || url.pathname === '/config' || /^\/(api|v1|rooms)\//.test(url.pathname)) {
      url.protocol = 'http:'
      url.host = '127.0.0.1:32181'
      return env.PROMPTPLAY_API.fetch(new Request(url, request))
    }
    return app.fetch(request, env, ctx)
  },
}
