import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR || '.next',
  webpack(webpackConfig, { isServer, webpack }) {
    if (!isServer) {
      // Pyodide's npm entry uses Node.js built-ins guarded by runtime env checks.
      // Strip the node: URI prefix so fallback can stub them to empty modules.
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (r: { request: string }) => {
          r.request = r.request.replace(/^node:/, '')
        })
      )
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        child_process: false,
        crypto: false,
        fs: false,
        os: false,
        path: false,
        stream: false,
        url: false,
        util: false,
        buffer: false,
        perf_hooks: false,
        worker_threads: false,
        v8: false,
        net: false,
        tls: false,
      }
    }
    return webpackConfig
  },
}
export default config
