import React from 'react'
import { render } from 'ink'
import { App } from './app.js'
import { ensureServer } from './bootstrap.js'
import pkg from '../../package.json' with { type: 'json' }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness-tui ${pkg.version}`)
  process.exit(0)
}

const port = parseInt(process.env.HARNESS_PORT ?? '7337')

const { cleanup } = await ensureServer(port)

const instance = render(<App />)

const shutdown = () => { cleanup(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
instance.waitUntilExit().then(() => { cleanup() })
