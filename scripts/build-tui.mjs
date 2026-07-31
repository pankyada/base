#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const packageJSON = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = process.env.npm_package_version ?? packageJSON.version
mkdirSync(resolve(root, 'bin'), { recursive: true })
for (const [goos, goarch, suffix] of [['darwin', 'arm64', 'darwin-arm64'], ['darwin', 'amd64', 'darwin-amd64'], ['linux', 'amd64', 'linux-amd64']]) {
  execFileSync('go', ['build', '-ldflags', `-s -w -X main.version=${version}`, '-o', resolve(root, `bin/harness-tui-${suffix}`), '.'], {
    cwd: resolve(root, 'tui'),
    env: { ...process.env, GOOS: goos, GOARCH: goarch },
    stdio: 'inherit',
  })
}
