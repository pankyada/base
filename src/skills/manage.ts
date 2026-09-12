import matter from 'gray-matter'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { homedir } from 'os'
import type { Profile } from '../profiles/schema.js'
import type { SkillSummary } from '../types.js'
import { loadAllSkills, resolveSkillsDirs } from './loader.js'

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

function assertName(name: string): void {
  if (!NAME.test(name) || name.includes('..') || name.includes('/') || name.includes('\\') || name.startsWith('/')) {
    throw new Error(`invalid skill name '${name}'`)
  }
}

function inside(root: string, path: string): string {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, path)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel === '..' || rel.startsWith(`..${pathSeparator()}`) || resolve(resolvedRoot, rel) !== resolvedPath) {
    throw new Error('skill path escapes expected root')
  }
  const physicalRoot = physicalCandidate(resolvedRoot)
  const physicalPath = physicalCandidate(resolvedPath)
  const physicalRel = relative(physicalRoot, physicalPath)
  if (physicalRel === '..' || physicalRel.startsWith(`..${pathSeparator()}`) || isAbsolutePhysical(physicalRel)) {
    throw new Error('skill path escapes expected root')
  }
  return resolvedPath
}

function pathSeparator(): string { return '/' }
function isAbsolutePhysical(path: string): boolean { return path.startsWith('/') }

function physicalCandidate(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  let existingParent = path
  while (!existsSync(existingParent)) {
    const parent = dirname(existingParent)
    if (parent === existingParent) break
    existingParent = parent
  }
  return resolve(realpathSync(existingParent), relative(existingParent, path))
}

function gitRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    return process.cwd()
  }
}

function proposedRoot(profile: Profile): string { return resolve(profile.artifact_dir, 'skills', '_proposed') }
function discardedRoot(profile: Profile): string { return resolve(profile.artifact_dir, 'skills', '_discarded') }
function installedRoot(): string { return resolve(gitRoot(), '.agents', 'skills') }

function summary(name: string, description: string, path: string, source: 'proposed' | 'installed'): SkillSummary {
  return { name, description, path, source, mtime: statSync(path).mtime.toISOString() }
}

export function listProposed(profile: Profile): SkillSummary[] {
  const root = proposedRoot(profile)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    try {
      assertName(entry.name)
      const path = inside(root, join(entry.name, 'SKILL.md'))
      if (!existsSync(path)) return []
      const { data } = matter(readFileSync(path, 'utf8'))
      if (typeof data.name !== 'string' || typeof data.description !== 'string') return []
      return [summary(entry.name, data.description, path, 'proposed')]
    } catch {
      return []
    }
  })
}

export function listInstalled(cwd = process.cwd()): SkillSummary[] {
  return loadAllSkills(resolveSkillsDirs(cwd)).flatMap(skill => {
    try {
      return [summary(skill.name, skill.description, skill.filePath, 'installed')]
    } catch {
      return []
    }
  })
}

function skillPath(name: string, source: 'proposed' | 'installed', profile: Profile): string {
  assertName(name)
  const root = source === 'proposed' ? proposedRoot(profile) : installedRoot()
  return inside(root, join(name, 'SKILL.md'))
}

export function readSkill(name: string, source: 'proposed' | 'installed', profile: Profile): { name: string; source: string; path: string; content: string } {
  const path = skillPath(name, source, profile)
  if (!existsSync(path)) throw new Error(`skill '${name}' not found`)
  return { name, source, path, content: readFileSync(path, 'utf8') }
}

function validateContent(name: string, content: string): void {
  assertName(name)
  const { data } = matter(content)
  if (typeof data.name !== 'string' || !data.name.trim() || typeof data.description !== 'string' || !data.description.trim()) {
    throw new Error('skill frontmatter requires non-empty name and description')
  }
  if (data.name !== name) throw new Error(`frontmatter name '${data.name}' does not match directory '${name}'`)
}

export function writeSkill(name: string, content: string, profile: Profile): { path: string } {
  validateContent(name, content)
  const path = skillPath(name, 'proposed', profile)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return { path }
}

export function promoteSkill(name: string, profile: Profile, force = false): { path: string } {
  assertName(name)
  const sourceDir = inside(proposedRoot(profile), name)
  const targetDir = inside(installedRoot(), name)
  const content = readSkill(name, 'proposed', profile).content
  validateContent(name, content)
  if (existsSync(targetDir) && !force) throw new Error(`skill '${name}' already installed`)
  mkdirSync(dirname(targetDir), { recursive: true })
  let backupDir = ''
  if (existsSync(targetDir)) {
    if (!force) throw new Error(`skill '${name}' already installed`)
    backupDir = `${targetDir}.backup-${Date.now()}`
    while (existsSync(backupDir)) backupDir += '-1'
    renameSync(targetDir, backupDir)
  }
  try {
    renameSync(sourceDir, targetDir)
  } catch (error) {
    if (backupDir && existsSync(backupDir) && !existsSync(targetDir)) {
      renameSync(backupDir, targetDir)
    }
    throw error
  }
  return { path: join(targetDir, 'SKILL.md') }
}

export function discardSkill(name: string, profile: Profile): { path: string } {
  assertName(name)
  const sourceDir = inside(proposedRoot(profile), name)
  if (!existsSync(sourceDir)) throw new Error(`skill '${name}' not found`)
  const destination = inside(discardedRoot(profile), `${name}-${Date.now()}`)
  mkdirSync(dirname(destination), { recursive: true })
  renameSync(sourceDir, destination)
  return { path: destination }
}
