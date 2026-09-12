#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, platform, arch } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const destination = join(homedir(), '.local', 'bin')
const os = platform()
const cpu = arch()
const tuiSuffix = os === 'darwin' && cpu === 'arm64' ? 'darwin-arm64'
  : os === 'darwin' && cpu === 'x64' ? 'darwin-amd64'
    : os === 'linux' && cpu === 'x64' ? 'linux-amd64'
      : os === 'win32' && cpu === 'x64' ? 'windows-amd64.exe' : ''

if (!tuiSuffix) throw new Error(`No harness-tui release asset for ${os}/${cpu}`)
mkdirSync(destination, { recursive: true })
for (const name of ['harness', 'harness-server']) copyFileSync(join(root, 'bin', name), join(destination, name))
const tui = join(destination, os === 'win32' ? 'harness-tui.exe' : 'harness-tui')
copyFileSync(join(root, 'bin', `harness-tui-${tuiSuffix}`), tui)
if (os === 'darwin') {
  for (const name of ['harness-server', 'harness-tui']) {
    execFileSync('codesign', ['--force', '--sign', '-', join(destination, name)], { stdio: 'inherit' })
  }
}
console.log(`Installed Harness binaries to ${destination}`)
