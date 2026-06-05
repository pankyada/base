# Telemetry

Every tool call, skill load, MCP invocation, and LLM completion is logged as a JSONL event to `~/.harness/telemetry.jsonl`.

## Event schema

```ts
interface TelemetryEvent {
  ts: string          // ISO 8601 timestamp
  session: string     // session ID
  profile: string     // profile name
  kind: 'tool' | 'skill' | 'mcp' | 'llm'
  name?: string       // tool name, skill name, or model ID
  server?: string     // MCP server name (kind=mcp only)
  model?: string      // model ID (kind=llm only)
  duration_ms?: number
  ok?: boolean        // true = success, false = error
  tokens_in?: number  // (kind=llm only)
  tokens_out?: number // (kind=llm only)
  cost_usd?: number   // (kind=llm only)
  trigger?: string    // 'model' for skill loads
}
```

## File location

```
~/.harness/telemetry.jsonl
```

Rotates at 5 MB, keeping up to 5 rotated files (`telemetry.jsonl.1` … `telemetry.jsonl.5`).

## Querying with jq

**All tool calls in the last session:**
```bash
SESSION=$(tail -1 ~/.harness/telemetry.jsonl | jq -r .session)
jq -r "select(.session == \"$SESSION\" and .kind == \"tool\") | [.ts, .name, .ok] | @tsv" \
  ~/.harness/telemetry.jsonl
```

**Total cost this month:**
```bash
MONTH=$(date +%Y-%m)
jq -r "select(.kind == \"llm\" and .ts[:7] == \"$MONTH\") | .cost_usd // 0" \
  ~/.harness/telemetry.jsonl | awk '{sum+=$1} END {printf "USD %.4f\n", sum}'
```

**Top 10 tools by call count:**
```bash
jq -r 'select(.kind == "tool") | .name' ~/.harness/telemetry.jsonl \
  | sort | uniq -c | sort -rn | head -10
```

**Failed tool calls:**
```bash
jq -r 'select(.kind == "tool" and .ok == false) | [.ts, .profile, .name] | @tsv' \
  ~/.harness/telemetry.jsonl
```

**LLM cost by profile:**
```bash
jq -r 'select(.kind == "llm") | [.profile, (.cost_usd // 0)] | @tsv' \
  ~/.harness/telemetry.jsonl \
  | awk '{a[$1]+=$2} END {for (p in a) printf "%.4f\t%s\n", a[p], p}' \
  | sort -rn
```

## In-agent stats

Use the `Stats` tool to query telemetry from within a session:

```
Stats({ since_days: 7 })
```

Returns a human-readable summary of top tools, skills, MCP calls, and cost for the last 7 days.
