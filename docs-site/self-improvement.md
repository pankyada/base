# Self-Improvement

After each session, the harness runs a reflection pass to extract learnings and — every N sessions — mine new skills from recurring patterns.

## Configuration

```yaml
improvement:
  enabled: true                      # set false to disable entirely
  model_id: claude-haiku-4-5-20251001  # optional — cheaper model for reflection
  mine_skills_every_n_sessions: 10   # how often to run skill mining (default 10)
```

## Reflection loop

At the end of every session (on disconnect or `/cancel`):

1. The agent transcript (last session only, trimmed to 8000 chars) is sent to the reflection model
2. The model identifies 0–3 things worth remembering for future sessions
3. Each finding is written to `user` scope memory with a short key

```
# Example: agent learned the user prefers pytest over unittest
MemoryWrite({
  scope: "user",
  key: "test-framework-preference",
  content: "User prefers pytest. Do not suggest unittest."
})
```

These memories are injected into the system prompt for all future sessions with the same profile + user combination.

## Skill mining

Every `mine_skills_every_n_sessions` sessions, the reflection model also reviews recent transcripts for recurring patterns. If a pattern appears worth extracting, a proposed skill is written to `<artifact_dir>/learnings/<date>.md` for human review.

Proposed skills are **not** automatically registered — a human reviews and moves the file to `.agents/skills/<name>/SKILL.md` to activate it.

## Disabling per-profile

```yaml
improvement:
  enabled: false
```

Worker profiles (sub-agents) should typically set `enabled: false` — they run headless and reflection adds cost without benefit.

## Storage

- Per-session learnings: appended to `<artifact_dir>/learnings/<YYYY-MM-DD>.md`
- Memories: written to `~/.harness/memory/<profile>/<user>/` via `MemoryWrite`
- Session count (for N-session trigger): `<artifact_dir>/session-count.json`
