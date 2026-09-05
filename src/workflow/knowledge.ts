import OpenAI from 'openai'
import { z } from 'zod'
import type { Profile } from '../profiles/schema.js'
import { resolveRole } from '../profiles/schema.js'
import type { MemoryLink, MemoryProvider, TemporalMeta } from '../memory/interface.js'
import type { Stage } from './types.js'
import type { ProviderClient } from '../provider/types.js'

export interface KnowledgeNode {
  key: string
  type: 'Decision' | 'Constraint' | 'Component' | 'Requirement' | 'Risk' | 'Finding' | 'Followup'
  content: string
  temporal?: TemporalMeta
}

const NodeType = z.enum(['Decision', 'Constraint', 'Component', 'Requirement', 'Risk', 'Finding', 'Followup'])
const TemporalSchema = z.object({
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
  recur: z.string().optional(),
  timezone: z.string().optional(),
  entity: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  supersedes: z.string().optional(),
}).strict()
const ExtractSchema = z.object({
  nodes: z.array(z.object({ key: z.string().min(1), type: NodeType, content: z.string().min(1), temporal: TemporalSchema.optional() })),
  edges: z.array(z.object({ source: z.string().optional(), target: z.string(), relation: z.enum(['depends_on', 'implements', 'supersedes', 'contradicts', 'generalizes_to', 'evidence_for']) })),
})

function stripJson(raw: string): string {
  return raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export async function extractKnowledge(artifact: string, stage: Stage, openai: OpenAI | undefined, profile: Profile, provider?: ProviderClient): Promise<{ nodes: KnowledgeNode[]; edges: MemoryLink[] }> {
  if (!profile.workflow?.knowledge.graph) return { nodes: [], edges: [] }
  try {
    const prompt = `Extract durable project knowledge from this ${stage} artifact. Return ONLY JSON with nodes and typed edges. Add optional temporal metadata only when the artifact gives a clear explicit signal; use ISO-8601 timestamps with offsets and do not infer dates or recurrence.\n${artifact}`
    const content = provider
      ? (await provider.generate({ model: resolveRole(profile, 'cheap'), stream: false, maxTokens: 500, temperature: 0, messages: [{ role: 'user', content: prompt }] }, { purpose: 'workflow-knowledge' })).text
      : openai ? String((await (openai.chat.completions as any).create({ model: resolveRole(profile, 'cheap'), messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0 })).choices?.[0]?.message?.content ?? '{}') : '{}'
    const parsed = ExtractSchema.parse(JSON.parse(stripJson(content)))
    return { nodes: parsed.nodes, edges: parsed.edges }
  } catch {
    return { nodes: [], edges: [] }
  }
}

function likelyDecision(entry: { key: string; preview: string; links?: MemoryLink[] }): boolean {
  return entry.key.toLowerCase().startsWith('decision') || entry.preview.toLowerCase().startsWith('decision:') || entry.links?.some(link => link.relation === 'knowledge-type:Decision') === true
}

export async function persistKnowledge(memory: MemoryProvider, nodes: KnowledgeNode[], edges: MemoryLink[]): Promise<void> {
  if (nodes.length === 0) return
  const existingEntries = await memory.list('project')
  for (const node of nodes) {
    const existing = await memory.read('project', node.key)
    const outgoing = edges.filter(edge => edge.source === node.key || (!edge.source && (edges.length === 1 || edge.target === node.key)))
    const links = [...(existing?.links ?? []), ...outgoing]
    if (node.type === 'Decision') {
      for (const prior of existingEntries) {
        if (prior.key === node.key || !likelyDecision(prior)) continue
        const priorContent = (await memory.read('project', prior.key))?.content ?? prior.preview
        if (priorContent.trim() !== node.content.trim()) links.push({ source: node.key, target: prior.key, relation: 'contradicts' })
      }
      links.push({ source: node.key, target: node.key, relation: 'knowledge-type:Decision' })
    }
    await memory.write('project', node.key, node.content, dedupeLinks(links), node.temporal ?? existing?.temporal)
  }
}

function dedupeLinks(links: MemoryLink[]): MemoryLink[] {
  const seen = new Set<string>()
  return links.filter(link => {
    const key = `${link.source ?? ''}|${link.target}|${link.relation ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function queryProjectGraph(memory: MemoryProvider, hints: string): Promise<string> {
  const entries = await memory.list('project')
  if (entries.length === 0) return 'no prior project knowledge'
  const needle = hints.toLowerCase()
  const matches = entries.filter(entry => !needle || `${entry.key} ${entry.preview}`.toLowerCase().includes(needle))
  const selected = (matches.length > 0 ? matches : entries).slice(0, 8)
  return selected.map(entry => `- ${entry.key}: ${entry.preview}`).join('\n') || 'no prior project knowledge'
}

export function generalizationFromReview(body: string): { nodes: KnowledgeNode[]; edges: MemoryLink[] } {
  const section = body.match(/(?:^|\n)#{1,4}\s*Generalization\s*\n([\s\S]*?)(?=\n#{1,4}\s|$)/i)?.[1] ?? ''
  if (!/\byes\b/i.test(section)) return { nodes: [], edges: [] }
  const followup: KnowledgeNode = { key: `followup-${Date.now().toString(36)}`, type: 'Followup', content: section.trim() }
  return { nodes: [followup], edges: [{ target: followup.key, relation: 'generalizes_to' }] }
}
