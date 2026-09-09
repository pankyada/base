export interface PromptAssemblyDiagnostics {
  sources: Array<'profile' | 'project' | 'skills' | 'memory'>
  ordering: string[]
  sizes: { profile: number; project: number; skills: number; memory: number; total: number }
}

export function promptAssemblyDiagnostics(parts: { profile: string; project: string; skills: string; memory: string }): PromptAssemblyDiagnostics {
  const sizes = { profile: parts.profile.length, project: parts.project.length, skills: parts.skills.length, memory: parts.memory.length, total: Object.values(parts).reduce((sum, value) => sum + value.length, 0) }
  return { sources: ['profile', 'project', 'skills', 'memory'], ordering: ['profile', 'project', 'skills', 'memory'], sizes }
}
