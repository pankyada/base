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
  Stats: AclValue.default('allow'),
  Delegate: AclValue.default('prompt'),
}).passthrough()

const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  acl: z.record(z.string(), AclValue).default({ '*': 'prompt' }),
})

export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({
    base_url: z.string().url(),
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
      mcp_servers: z.array(McpServerSchema).default([]),
    })
  ),
  hooks: z.preprocess(
    (val) => val ?? {},
    z.object({
      pre_tool: z.array(z.string()).default([]),
      post_tool: z.array(z.string()).default([]),
      on_stop: z.array(z.string()).default([]),
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
})

export type Profile = z.infer<typeof ProfileSchema>
