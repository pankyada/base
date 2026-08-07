# Safety & Governance

Most agent harnesses stop at a static allow / prompt / deny list per tool.
Harness adds four more layers on top of that, aimed specifically at
**unattended** agents — the ones running from a [trigger](./automation) with
nobody watching: argument-aware conditions, a structural defense against
prompt injection from content the agent itself read, a hard spend ceiling,
and a complete, undo-able paper trail. Each layer can only *narrow* what's
already allowed — none of them can turn a `deny` into anything else.

```
mode defaults
  └─▶ profile ACL (string or conditional object)
        └─▶ approval mode (strict / bash / danger / yolo)
              └─▶ provenance gate (only escalates, never bypassed by yolo)
```

## Instance modes

`mode:` sets a default trust posture in one field instead of hand-tuning a
dozen ACL entries per deployment shape. Explicit `tools.builtin` entries
still win on conflict — modes set the floor, not a ceiling.

| Mode | Use case | Bash | Write/Edit | ExecuteCode |
|------|----------|------|-----------|-------------|
| `developer` | Local dev, single-tenant | allow | allow | allow |
| `analyst` | Data analysis, sandboxed | deny | deny | allow |
| `assistant` | Chat assistant, multi-tenant | deny | deny | deny |
| `production` | Customer-facing, strict | deny | deny | deny |

```yaml
mode: analyst
```

The example profiles under `profiles/` intentionally omit `mode:` and use
explicit ACLs instead — see [Profiles](./profiles#tools) for the full field
reference. `mode: developer` combined with any trigger is a hard validation
error at startup: an always-on, fully-trusted agent is a contradiction the
schema catches instead of leaving as a footgun.

## Conditional ACL

A plain ACL value (`allow` / `prompt` / `deny`) works exactly like it does in
any other harness. What's different: an ACL entry can instead be an object
with `allow_if` / `deny_if` predicates, so a profile can express "allow this
tool **when the arguments look like this**, ask otherwise" — the rule that
makes unattended autonomy tolerable. Without it, every profile faces a bad
binary: `Notify: allow` means an agent can message anyone; `Notify: prompt`
means it wakes a human to approve its own morning brief.

```yaml
tools:
  builtin:
    Notify:
      default: prompt
      allow_if:
        - { arg: channel, in_list: trusted_channels }
    Write:
      default: prompt
      allow_if:
        - { arg: path, under_path: "$VAULT/inbox" }
    MemoryWrite:
      default: allow
      deny_if:
        - { arg: scope, equals: profile }

lists:
  trusted_channels: [phone]
```

Evaluation is deliberately boring and auditable:

```
deny_if any match   ─▶ deny        (deny always wins)
allow_if all match   ─▶ allow       (AND-of-conditions; use two rules for OR)
otherwise            ─▶ default
```

### Predicate vocabulary — a closed set

| Predicate | Semantics |
|---|---|
| `equals` | exact scalar match |
| `in_list` | membership in a named `lists:` entry (or a memory-sourced list) |
| `matches` | glob — not regex, so there's no catastrophic backtracking or injection surface |
| `under_path` | resolved-realpath containment, symlink-safe |
| `lt` / `gt` | numeric comparison |
| `absent` / `present` | argument presence |

There is no code-evaluation predicate — no JS expressions, no sandboxed
lambdas, no regex-with-backrefs from config. **A config file that can execute
is a config file that can be exploited.** An unknown predicate is a hard
error at profile load, never a silently-skipped rule. `arg` supports dotted
paths into the tool input (`recipient.email`); a missing path evaluates
`false` for both `allow_if` and `deny_if` — absence never grants.

### List sources

`lists:` entries can be inline, or sourced from memory so a trusted-contacts
list can grow over time without a profile edit:

```yaml
lists:
  trusted_channels: [phone]
  trusted_contacts: "memory:user/trusted-contacts"
```

A read failure on a memory-sourced list **denies** — it never silently falls
through to the ACL default.

## Provenance gate

Once an agent reads content someone else wrote — a web page, an inbound
channel message, an MCP tool result — its context contains instructions that
are token-indistinguishable from the user's own. Prompt-level defenses
against this are probabilistic. The provenance gate closes the path
structurally instead.

```yaml
safety:
  gate_untrusted_actions: true   # default false in the harness, true under mode: assistant / production
  gate_writes: false             # also gate write-class tools, not just outbound/destructive
```

Every tool result carries a `provenance` tag — **untrusted by default** for
anything network- or channel-sourced. A monotonic per-turn taint flag is
stored directly on the session ledger (not derived from it, so [context
projection](./context) can't accidentally elide it back to untainted) and
resets only on a genuine human message. When a turn is tainted, `outbound`
and `destructive` tools escalate to approval **regardless of ACL** — and
neither a matching `allow_if` predicate nor `yolo` approval mode can bypass
that escalation. The claim is deliberately narrow: *content the agent read
can never silently authorize an action.* The model can still be fooled; the
gate holds anyway.

## Autonomy budget

Triggered runs have no human watching, so they get a hard resource ceiling
instead:

```yaml
triggers:
  budget:
    max_cost_usd: 0.50
    max_tools: 30
    max_wall_s: 300
```

Checked before **every** model call and **every** tool call — never only at
the end of a turn, which would be a receipt, not a budget.

- **Fails closed.** An unreadable or malformed budget is treated as zero,
  not infinity; the run refuses to start.
- **Applies to triggered runs by default**; interactive runs only if
  configured — a human watching a session is their own budget.
- **Delegated sub-agents share the parent's actual remaining ledger**, not a
  fresh allowance, so [fan-out](./multi-agent) can't multiply spend.
- On exceed, the run aborts with `status: 'budget_exceeded'`, partial work is
  preserved and inspectable in the session ledger, and a [channel](./automation#channels)
  notifies what was spent and what was still in flight.

## Audit journal + undo

Distinct from [telemetry](./telemetry) on purpose: telemetry is sampled and
disposable, the audit journal is complete, per-action, and the thing you read
at 3am when something went wrong.

```
~/.harness/audit/<user>/<date>.jsonl
```

Every effectful tool call produces exactly one entry recording `decided_by`
(`default` / `predicate` / `mode` / `human` / `gate`) and `decided_reason` —
so "why did my assistant send that" is answerable by `grep`, never by
re-reading YAML and guessing.

```bash
harness audit --since 2026-08-01 --tool Notify
harness audit --undo <entry_id>
```

Core ships inverses for its own tools: `Write` restores prior content from
the ledger, `MemoryWrite`/`MemoryDelete` restore the prior value. Other tools
may attach their own `undo` descriptor to their result; entries without one
are honestly reported as **not-undoable** rather than silently ignored.

## See also

- [Automation](./automation) — triggers, deferred asks, and channels: the
  unattended surface this layer exists to govern
- [Profiles](./profiles#tools) — full `tools:`, `lists:`, and `triggers:`
  field reference
- [Architecture](./architecture) — where this layer sits in the request
  lifecycle
