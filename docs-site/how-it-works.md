# How it works

Four short, animated walkthroughs — one per use case in [Use Cases](./use-cases)
— showing what actually happens at runtime, beat by beat.

This page is deliberately narrower than the
**[interactive architecture explorer](/architecture-site/index.html)**. The
explorer is a *map*: every layer, module, and file, with one generic 11-step
request lifecycle. These films are *narrative*: what a specific scenario does,
in order, with the real terminal states the runtime actually has — a budget
abort, a contract rejection, an ACL denial, a durable deferred question. Read
the explorer to see what exists. Watch these to see what happens.

Each film cites the real source files it depicts — nothing here is staged.
Click a beat to jump to it; play/pause and a 2× speed toggle sit under each
film. With reduced motion enabled, every film renders as a plain numbered list
instead — nothing here requires the animation to be understood.

## 1. Coding assistant

A developer, in the loop the whole time. Every `Bash` call still asks first —
watch the run pause and wait for a human.

<UseCaseFilm id="coding" />

Full profile and rationale: [Use Cases → Coding assistant](./use-cases#1-coding-assistant).

## 2. Personal assistant with voice

A question gets parked to disk, the server restarts, and the question is still
there hours later. That's not an in-memory promise — it's a file.

<UseCaseFilm id="assistant" />

Full profile and rationale: [Use Cases → Personal assistant with voice](./use-cases#2-personal-assistant-with-voice).

## 3. Production data-analysis agent

Called by code, not a human — so a bad request gets a 422 with a reason
instead of a guess, and `Bash: deny` means exactly that: refused, no prompt,
because there's no one to prompt.

<UseCaseFilm id="data" />

Full profile and rationale: [Use Cases → Production data-analysis agent](./use-cases#3-production-data-analysis-agent).

## 4. Unattended ops agent

Nobody's watching. Watch the free no-change path run first — the watcher polls,
nothing changed, zero cost — before an error spike fires a real run that pages
`oncall` through a conditional ACL and, if it gets stuck, halts on its own
budget ceiling rather than running up a bill.

<UseCaseFilm id="ops" />

Full profile and rationale: [Use Cases → Unattended ops agent](./use-cases#4-unattended-ops-agent).

## See also

- [Use Cases](./use-cases) — the full YAML and "why these choices" for each film
- [Architecture](./architecture) — the component map these films move through
- [Safety & Governance](./safety) — ACL, provenance gate, and autonomy budget in depth
