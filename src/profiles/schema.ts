import { z } from 'zod'
import type { Tier, Intensity } from '../workflow/types.js'

export const AclValue = z.enum(['allow', 'prompt', 'deny'])

const ChannelSchema = z.object({
  name: z.string().min(1),
  transport: z.string().min(1),
  inbound: z.boolean().default(false),
  default: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).default({}),
  acl: z.object({
    notify: AclValue.default('allow'),
    approvals: z.boolean().default(false),
    inbound: z.enum(['paired', 'open', 'off']).default('paired'),
  }).default({ notify: 'allow', approvals: false, inbound: 'paired' }),
  limits: z.object({
    max_sends_per_hour: z.number().int().positive().optional(),
  }).default({}),
})

export type ChannelConfig = z.infer<typeof ChannelSchema>

const BuiltinToolsSchema = z.object({
  Read: AclValue.default('allow'),
  Write: AclValue.default('allow'),
  Edit: AclValue.default('allow'),
  Bash: AclValue.default('prompt'),
  Grep: AclValue.default('allow'),
  Glob: AclValue.default('allow'),
  Skill: AclValue.default('allow'),
  MemoryRead: AclValue.default('allow'),
  MemoryWrite: AclValue.default('allow'),
  MemoryList: AclValue.default('allow'),
  MemoryDelete: AclValue.default('allow'),
  Recall: AclValue.default('allow'),
  Stats: AclValue.default('allow'),
  Delegate: AclValue.default('prompt'),
  ExecuteCode: AclValue.default('allow'),
  ContextRestore: AclValue.default('allow'),
  Notify: AclValue.default('allow'),
}).passthrough()

const McpAcl = z.record(z.string(), AclValue).default(() => ({ '*': 'prompt' as const }))

const StdioMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  acl: McpAcl,
})

const StreamableHttpMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('streamable-http'),
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
  acl: McpAcl,
})

const SseMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('sse'),
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
  acl: McpAcl,
})

const WebSocketMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('websocket'),
  url: z.string(),
  acl: McpAcl,
})

const McpServerSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object') {
      const t = (val as any).transport
      if (t === undefined || t === null || t === '') {
        return { ...(val as object), transport: 'stdio' }
      }
    }
    return val
  },
  z.discriminatedUnion('transport', [
    StdioMcpServerSchema,
    StreamableHttpMcpServerSchema,
    SseMcpServerSchema,
    WebSocketMcpServerSchema,
  ])
)

export type McpServerConfig = z.infer<typeof McpServerSchema>

const AgentEntrySchema = z.object({
  name: z.string(),
  profile: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
})

export type AgentEntry = z.infer<typeof AgentEntrySchema>

export const MODE_DEFAULTS: Record<string, Partial<Record<string, 'allow' | 'prompt' | 'deny'>>> = {
  developer: {
    Bash: 'allow', Read: 'allow', Write: 'allow', Edit: 'allow',
    Grep: 'allow', Glob: 'allow', Skill: 'allow', Stats: 'allow',
    Delegate: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow', Recall: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
    ExecuteCode: 'allow',
  },
  analyst: {
    Bash: 'deny', Write: 'deny', Edit: 'deny', Delegate: 'deny',
    Read: 'allow', ExecuteCode: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow', Recall: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
  },
  assistant: {
    Bash: 'deny', Write: 'deny', Edit: 'deny', Delegate: 'deny', ExecuteCode: 'deny',
    Read: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow', Recall: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
  },
  production: {
    Bash: 'deny', Write: 'deny', Edit: 'deny', Delegate: 'deny', ExecuteCode: 'deny',
    Read: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow', Recall: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
  },
}

const ExecutorSchema = z.object({
  default: z.enum(['wasm', 'docker']).default('docker'),
  fallback: z.literal('docker').default('docker'),
  docker_image: z.string().default('python:3.12-slim'),
  timeout_ms: z.number().default(30000),
  allowed_packages: z.array(z.string()).default([]),
})

export type ExecutorConfig = z.infer<typeof ExecutorSchema>

const SafetySchema = z.object({
  classifier_model_id: z.string().optional(),
  timeout_ms: z.number().default(3000),
  cache_ttl_hours: z.number().default(168),
  enabled: z.boolean().default(true),
})

const IntensityValue = z.number().int().min(0).max(3) as z.ZodType<Intensity>
const RoleModelsSchema = z.object({
  cheap: z.string().optional(),
  balanced: z.string().optional(),
  frontier: z.string().optional(),
  critic: z.string().optional(),
})
const WorkflowSchema = z.object({
  enabled: z.boolean().default(false),
  playbook: z.string().default('generic'),
  min_intensity: z.record(z.string(), IntensityValue).default({ recon: 1 }),
  max_intensity: z.record(z.string(), IntensityValue).default({}),
  budget: z.object({
    max_usd_per_task: z.number().positive().default(2),
    max_stage_retries: z.number().int().min(0).default(2),
    max_stage_minutes: z.number().positive().default(15),
  }).default({ max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 }),
  routing: z.object({
    policy: z.enum(['static', 'adaptive']).default('static'),
    explore_rate: z.number().min(0).max(0.5).default(0.12),
    shadow_rate: z.number().min(0).max(0.5).default(0.05),
    table: z.record(z.string(), z.enum(['cheap', 'balanced', 'frontier', 'critic'])).default({}),
  }).default({ policy: 'static', explore_rate: 0.12, shadow_rate: 0.05, table: {} }),
  knowledge: z.object({
    graph: z.boolean().default(false),
    generalization_probe: z.boolean().default(true),
  }).default({ graph: false, generalization_probe: true }),
})
export { RoleModelsSchema, WorkflowSchema }

const ContextSchema = z.object({
  max_tokens: z.number().positive().default(100000),
  high_water: z.number().min(0).max(1).default(0.80),
  low_water: z.number().min(0).max(1).default(0.45),
  tail_turns: z.number().int().min(0).default(3),
  pin_budget: z.number().min(0).max(1).default(0.25),
  digest_model_id: z.string().optional(),
  cache: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.high_water <= value.low_water) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['high_water'], message: 'high_water must be greater than low_water' })
  }
})

export type ContextConfig = z.infer<typeof ContextSchema>

export type SafetyConfig = z.infer<typeof SafetySchema>

export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({
    base_url: z.url(),
    api_key_env: z.string(),
    id: z.string(),
    fallback_id: z.string().optional(),
  }),
  models: z.object({ roles: RoleModelsSchema }).optional(),
  workflow: WorkflowSchema.optional(),
  system_prompt: z.string(),
  working_dir: z.string().default('$CWD'),
  artifact_dir: z.string(),
  tools: z.preprocess(
    (val) => val ?? {},
    z.object({
      builtin: z.preprocess((val) => val ?? {}, BuiltinToolsSchema),
      custom: z.record(z.string(), AclValue).default(() => ({ '*': 'prompt' as const })),
      mcp_servers: z.array(McpServerSchema).default([]),
    })
  ),
  hooks: z.preprocess(
    (val) => val ?? {},
    z.object({
      pre_tool: z.array(z.string()).default([]),
      post_tool: z.array(z.string()).default([]),
      on_stop: z.array(z.string()).default([]),
      timeout_ms: z.number().default(5000),
    })
  ),
  improvement: z.preprocess(
    (val) => val ?? {},
    z.object({
      enabled: z.boolean().default(true),
      model_id: z.string().optional(),
      mine_skills_every_n_sessions: z.number().default(10),
    })
  ),
  safety: z.preprocess(
    (val) => val ?? {},
    SafetySchema.default(() => ({ enabled: true, timeout_ms: 3000, cache_ttl_hours: 168 }))
  ),
  context_window: z.object({
    max_tokens: z.number().default(100000),
    model_id: z.string().optional(),
  }).optional(),
  context: ContextSchema.optional(),
  memory: z.preprocess(
    (val) => val ?? {},
    z.object({
      provider: z.enum(['fs', 'graph']).default('fs'),
    })
  ).optional(),
  max_depth: z.number().min(1).optional().default(2),
  agents: z.array(AgentEntrySchema).optional().default([]),
  contract: z.object({
    input: z.record(z.string(), z.unknown()).optional(),
    output: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  triggers: z.object({
    cron: z.string().optional(),
    webhook: z.boolean().default(false),
    cron_input: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  description: z.string().optional(),
  interop: z.object({
    a2a: z.boolean().default(false),
    acp: z.boolean().default(false),
  }).optional(),
  executor: ExecutorSchema.optional(),
  mode: z.enum(['developer', 'analyst', 'assistant', 'production']).optional(),
  channels: z.array(ChannelSchema).optional(),
}).transform(profile => {
  const channelNames = new Set<string>()
  for (const channel of profile.channels ?? []) {
    if (channelNames.has(channel.name)) throw new Error(`duplicate channel name '${channel.name}'`)
    channelNames.add(channel.name)
  }
  const context = profile.context ?? ContextSchema.parse({
    max_tokens: profile.context_window?.max_tokens,
    digest_model_id: profile.context_window?.model_id,
  })
  return { ...profile, context }
})

type ParsedProfile = z.infer<typeof ProfileSchema>
// Keep hand-built test/embedding profiles source-compatible while parsed YAML
// always receives the safe classifier defaults above.
export type Profile = Omit<ParsedProfile, 'safety' | 'context'> & { safety?: SafetyConfig; context?: ContextConfig }

export function resolveRole(profile: Profile, role: Tier): string {
  return profile.models?.roles?.[role] ?? profile.model.id
}
