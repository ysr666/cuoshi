import type {Plugin} from 'vite'

/** Independent cloud demo uses the same HTTP restrictions as root uni-app.
 * The root vite.config.ts remains self-contained for isolated RC compilation.
 * Limit DNS rebinding and cross-origin reads of pinned Vite 5.
 * Applies to both HTTP dev and preview requests, not release files or cloud API.
 * An HMR WebSocket bypasses Connect middleware, so HMR stays disabled until
 * upstream ships a compatible fixed Vite build.
 */
export function loopbackRequestGuard(): Plugin {
  const install = (server: { middlewares: { use: (middleware: (req: { headers: Record<string, unknown> }, res: {
    statusCode: number
    setHeader: (name: string, value: string) => void
    end: (body: string) => void
  }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const host = req.headers.host
      const origin = req.headers.origin
      const validHost = typeof host === 'string' &&
        /^(?:127\.0\.0\.1|localhost)(?::[1-9][0-9]{0,4})?$/.test(host) &&
        (!host.includes(':') || Number(host.split(':')[1]) <= 65535)
      const validOrigin = origin === undefined ||
        (typeof origin === 'string' && origin === `http://${host}`)
      if (!validHost || !validOrigin) {
        res.statusCode = 403
        res.setHeader('Cache-Control', 'no-store')
        res.end('Forbidden')
        return
      }
      next()
    })
  }
  return {
    name: 'cuoshi-loopback-request-guard',
    enforce: 'pre',
    configResolved(config) {
      // uni() reintroduces HMR in its own config merging step, overriding a
      // plain `server.hmr=false`. Enforce after all plugin config hooks.
      config.server.hmr = false
    },
    configureServer: install,
    configurePreviewServer: install
  }
}

