# MCP Servers

MCP (Model Context Protocol) servers extend the agent with external tools. Configure them in `tools.mcp_servers` of the profile YAML.

## Tool naming

MCP tools are exposed to the agent as `<serverName>__<toolName>`. For example, a server named `github` with a tool `list_pull_requests` becomes `github__list_pull_requests`. Tool parameter schemas are passed through from the server's `listTools` response.

## Transport types

`transport` defaults to `stdio` if omitted.

### `stdio` — local subprocess

Launches a local process and communicates over stdin/stdout. Most MCP servers use this transport.

```yaml
tools:
  mcp_servers:
    - name: filesystem
      transport: stdio       # optional — stdio is the default
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      env:
        SOME_VAR: "${SOME_VAR}"   # env var substitution
      acl:
        read_file: allow
        write_file: prompt
        "*": deny
```

`npx -y` handles first-run install automatically.

### `streamable-http` — modern remote MCP

HTTP transport using the MCP streamable HTTP spec. Use for hosted MCP services.

```yaml
    - name: my-remote
      transport: streamable-http
      url: https://my-mcp-server.example.com/mcp
      headers:
        Authorization: "Bearer ${MY_TOKEN}"
      acl:
        "*": prompt
```

### `sse` — legacy remote MCP

Server-Sent Events transport. Still common for older remote MCP services.

```yaml
    - name: legacy
      transport: sse
      url: https://legacy.example.com/sse
      headers: {}
      acl:
        "*": prompt
```

### `websocket`

WebSocket transport. Use for real-time bidirectional MCP connections.

```yaml
    - name: ws-server
      transport: websocket
      url: ws://localhost:8080/mcp
      acl:
        "*": prompt
```

## ACL configuration

MCP tools explicitly annotated with `readOnlyHint: true`, `destructiveHint: false`,
and `openWorldHint: false` are classified as reads before execution. This supports
repeated local database/document lookups after a prior result taints the turn.
The annotations do not grant ACL permission or make returned content trusted;
MCP results remain untrusted. Only configure servers whose claimed effects you
understand. Missing, open-world, or contradictory annotations do not receive
this read-effect override; network search may send private queries externally.

Each MCP server has its own `acl` block. The `*` wildcard is the fallback for any tool not explicitly listed.

```yaml
acl:
  list_pull_requests: allow    # always allowed
  create_pull_request: prompt  # ask user each time
  delete_repository: deny      # never allowed
  "*": prompt                  # everything else → ask
```

ACL values: `allow` | `prompt` | `deny`.

## Common server examples

### GitHub

```yaml
- name: github
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github"]
  env:
    GITHUB_TOKEN: "${GITHUB_TOKEN}"
  acl:
    list_pull_requests: allow
    get_pull_request: allow
    list_workflow_runs: allow
    "*": prompt
```

### Filesystem (scoped)

```yaml
- name: logs
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/var/log"]
  acl:
    read_file: allow
    list_directory: allow
    "*": deny
```

### Web fetch

```yaml
- name: fetch
  command: npx
  args: ["-y", "@modelcontextprotocol/server-fetch"]
  acl:
    fetch: allow
    "*": deny
```

### Brave search

```yaml
- name: brave
  command: npx
  args: ["-y", "@modelcontextprotocol/server-brave-search"]
  env:
    BRAVE_API_KEY: "${BRAVE_API_KEY}"
  acl:
    brave_web_search: allow
    "*": deny
```

## Isolation

Each WebSocket connection gets its own set of MCP client connections. Connections are created fresh per session and destroyed on session end. No state leaks between users.
