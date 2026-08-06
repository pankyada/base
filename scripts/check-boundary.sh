#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"

exec node --input-type=module - "$repo_root" "$script_dir/boundary-allowlist.txt" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'

const [repoRoot, allowlistPath] = process.argv.slice(2)
const terms = ['assistant', 'telegram', 'whatsapp', 'gmail', 'obsidian', 'elevenlabs', 'deepgram', 'voice']
const pattern = new RegExp(terms.join('|'), 'gi')

function readAllowlist(filePath) {
  const entries = new Set()
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('|')
    if (separator < 1) throw new Error(`invalid allowlist entry: ${rawLine}`)
    entries.add(`${line.slice(0, separator)}|${line.slice(separator + 1).toLowerCase()}`)
  }
  return entries
}

function sourceFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

// Remove comments while preserving line positions. Strings remain intact so a
// forbidden product/vendor term in executable data still fails the guard.
function withoutComments(source) {
  let output = ''
  let state = 'code'
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (state === 'line-comment') {
      if (char === '\n') {
        output += char
        state = 'code'
      } else {
        output += ' '
      }
      continue
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output += '  '
        index += 1
        state = 'code'
      } else {
        output += char === '\n' ? '\n' : ' '
      }
      continue
    }

    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if ((state === 'single-quote' && char === "'") ||
                 (state === 'double-quote' && char === '"') ||
                 (state === 'template' && char === '`')) {
        state = 'code'
      }
      continue
    }

    if (char === '/' && next === '/') {
      output += '  '
      index += 1
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      output += '  '
      index += 1
      state = 'block-comment'
    } else {
      output += char
      if (char === "'") state = 'single-quote'
      else if (char === '"') state = 'double-quote'
      else if (char === '`') state = 'template'
    }
  }
  return output
}

const allowlist = readAllowlist(allowlistPath)
const srcRoot = path.join(repoRoot, 'src')
const violations = []

// Core owns interfaces, never a product transport or audio vendor SDK. Keep
// this separate from the source-vocabulary scan: dependencies can smuggle a
// vendor into core even when its name never appears in source.
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const vendorPattern = /(elevenlabs|deepgram|twilio|telegram|whatsapp|discord|slack)/i
for (const [section, dependencies] of Object.entries({
  dependencies: packageJson.dependencies ?? {},
  devDependencies: packageJson.devDependencies ?? {},
})) {
  for (const name of Object.keys(dependencies)) {
    if (vendorPattern.test(name)) violations.push(`package.json: ${section}.${name}: vendor dependency is forbidden in core`)
  }
}

for (const filePath of sourceFiles(srcRoot)) {
  const source = fs.readFileSync(filePath)
  if (source.includes(0)) continue
  const stripped = withoutComments(source.toString('utf8'))
  for (const match of stripped.matchAll(pattern)) {
    const relativePath = path.relative(repoRoot, filePath)
    const line = stripped.slice(0, match.index).split('\n').length
    const term = match[0].toLowerCase()
    if (!allowlist.has(`${relativePath}|${term}`)) {
      const originalLine = source.toString('utf8').split('\n')[line - 1]?.trim() ?? ''
      violations.push(`${relativePath}:${line}: ${term}: ${originalLine}`)
    }
  }
}

if (violations.length > 0) {
  console.error('Boundary guard failed. Product/vendor vocabulary found in src/:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log('Boundary guard passed.')
NODE
