#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')

const bump = process.argv[2]
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: pnpm release <patch|minor|major>')
  process.exit(1)
}

// Fail fast if working tree has staged or unstaged changes to tracked files
const status = execSync('git status --porcelain').toString().trim().split('\n').filter(l => l && !l.startsWith('??')).join('\n')
if (status) {
  console.error('Working tree is dirty. Commit or stash changes first.')
  console.error(status)
  process.exit(1)
}

// Read and bump version
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const prev = pkg.version
const [major, minor, patch] = prev.split('.').map(Number)
const next =
  bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log(`Bumped version: ${prev} → ${next}`)

// Git commit + tag
execSync('git add package.json')
execSync(`git commit -m "chore: release v${next}"`)
execSync(`git tag v${next}`)
console.log(`Tagged: v${next}`)

// Build binaries
console.log('Building binaries...')
execSync('pnpm build:bin', { stdio: 'inherit' })
console.log('Done. Binaries in bin/')
