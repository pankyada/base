import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ProfileSchema, Profile } from './schema.js'

function untildify(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p
}

function expandPath(p: string, cwd: string): string {
  if (p === '$CWD') return cwd
  return resolve(untildify(p))
}

export function loadProfile(profilePath: string): Profile {
  const raw = readFileSync(profilePath, 'utf-8')
  const parsed = yaml.load(raw)
  const validated = ProfileSchema.parse(parsed)
  const cwd = process.cwd()
  return {
    ...validated,
    working_dir: expandPath(validated.working_dir, cwd),
    artifact_dir: expandPath(validated.artifact_dir, cwd),
    system_prompt: expandPath(validated.system_prompt, cwd),
    skills_dirs: validated.skills_dirs.map(d => expandPath(d, cwd)),
  }
}
