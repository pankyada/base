import { z } from 'zod'

const AclValue = z.enum(['allow', 'prompt', 'deny'])

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
  Stats: AclValue.default('allow'),
  Delegate: AclValue.default('prompt'),
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

export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({
    base_url: z.url(),
    api_key_env: z.string(),
    id: z.string(),
    fallback_id: z.string().optional(),
  }),
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
  context_window: z.object({
    max_tokens: z.number().default(100000),
    model_id: z.string().optional(),
  }).optional(),
  memory: z.preprocess(
    (val) => val ?? {},
    z.object({
      provider: z.enum(['fs', 'graph']).default('fs'),
    })
  ).optional(),
  max_depth: z.number().min(1).optional().default(2),
  agents: z.array(AgentEntrySchema).optional().default([]),
})

export type Profile = z.infer<typeof ProfileSchema>
