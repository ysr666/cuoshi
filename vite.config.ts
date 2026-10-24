import { defineConfig, type Plugin } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/** Limit DNS rebinding and cross-origin reads of the pinned Vite 5 dev server.
 * Applies to both HTTP dev and preview requests, not release files or cloud API.
 * An HMR WebSocket bypasses Connect middleware, so HMR stays disabled until
 * upstream ships a compatible fixed Vite build.
 */
function loopbackRequestGuard(): Plugin {
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

export default defineConfig({
  plugins: [loopbackRequestGuard(), uni()],
  // The DCloud build peer requires the vulnerable Vite 5.2.8. Bound to local
  // IPv4 and refuse other Host / Origin values (including DNS-rebound names).
  // HMR is disabled until the plugin supports an advisory-free Vite version.
  server: { host: '127.0.0.1', strictPort: true, cors: false, hmr: false },
  preview: { host: '127.0.0.1', strictPort: true, cors: false }
})
