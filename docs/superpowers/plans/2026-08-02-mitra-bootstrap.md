# Mitra — Branding & Repo Bootstrap

> Date: 2026-08-02
> Status: Ready to execute
> Related: [`2026-08-02-personal-assistant-plan.md`](2026-08-02-personal-assistant-plan.md),
> [`../../ADR.md`](../../ADR.md) (ADR-57 coupling, ADR-28 boundary)

Everything needed to go from nothing to a working `mitra` repo with `base`
submoduled in. Executes Task A1.1 of the plan; the rest of Sprint A1 (config,
secrets, CLI, wizard) follows in that repo.

---

# Part 1 — Branding

## The name

**Mitra** (मित्र) — Sanskrit for *friend*, and the name of the Vedic deity of
**contracts, oaths, and kept agreements**. Mitra is the god you swear by; the
one who witnesses that a promise was made and holds both parties to it.

That is an unusually exact fit. This assistant's differentiator is not that it
has more integrations — it is that its autonomy is *bounded and auditable*:
budgets it cannot exceed, allowlists it acts inside, a gate that stops it acting
on a stranger's instructions, and an audit journal that records why every action
was permitted. The design is fundamentally about an agent that keeps its
agreements and can prove it.

It also answers the original framing directly: a helper, a friend.

**Tagline:** *An assistant that keeps its agreements.*

**Positioning line (README first paragraph):**
> Mitra is a personal assistant you run yourself. It reads your mail, calendar,
> notes and money, tells you what matters before you ask, and acts on your behalf
> inside limits you set. Every autonomous action is budgeted, gated, and logged
> with the reason it was allowed.

## What the name commits you to

A name is a promise, and this one is checkable. If Mitra is about kept
agreements, three things must be *visible product surfaces*, not settings pages:

1. **The audit trail is a feature, not a debug log.** `mitra audit` and the web
   audit view are first-class. A user should be able to ask "what did you do
   today and why?" and get a complete, readable answer. (ADR-45)
2. **Limits are legible.** Budgets, allowlists, and quiet hours are shown in
   plain language, not YAML. "Mitra may auto-file mail and reply to 6 people;
   everything else it asks."
3. **Refusals are explained.** When the gate stops something, the message names
   the untrusted source. (ADR-49) "I didn't send that — the instruction came
   from an email, not from you."

If a feature makes those three harder to see, it is off-brand regardless of how
useful it is.

## Voice

How Mitra writes, in messages and in the CLI:

| Do | Don't |
|---|---|
| Short. One idea per message. | Paragraphs on a phone screen |
| Lead with the answer, then the detail | Preamble, throat-clearing |
| Name what it did and what it skipped | Silent partial success |
| Ask one thing at a time | Multi-part questions in chat |
| Plain about uncertainty | False confidence, hedging mush |
| Quiet by default | Notification for every event |

No persona name-dropping ("As Mitra, I…"), no emoji-as-personality, no
cheerfulness about bad news. Voice register for spoken output is separate and
terser still (`system_prompt_voice`, ADR-55).

## Naming conventions inside the repo

| Thing | Convention | Example |
|---|---|---|
| GitHub repo | `mitra` | `github.com/pankyada/mitra` |
| CLI binary | `mitra` | `mitra status` |
| Workspace packages | `@mitra/<area>` | `@mitra/core`, `@mitra/cli` |
| Config file | `mitra.config.yaml` | repo root / `~/.mitra/` |
| State dir | `~/.mitra/` | secrets, bindings, cursors |
| Profiles | plain nouns | `assistant.yaml`, `brief.yaml`, `triage.yaml` |
| CLI verbs | plain imperatives | `init`, `start`, `status`, `doctor`, `audit` |
| Docker image | `mitra` | `ghcr.io/pankyada/mitra` |

Harness state stays in `~/.harness/` — that is the submodule's business. Mitra's
own state is `~/.mitra/`. Keeping them separate means a harness upgrade never
threatens product state, and a Mitra reset never destroys session history.

## Visual identity (minimum viable)

Not a priority before A8, but decide once so nothing has to be redone:

- **Mark:** two interlocking arcs — a handshake abstracted, or the knot of a
  bound agreement. Monochrome, works at 16px for a favicon and in a terminal at
  one character.
- **Palette:** single accent, warm — an indigo/saffron range reads correctly for
  the name's origin without being a costume. Neutral greys everywhere else.
  Status colors are functional only: green ran, amber asked, red blocked.
- **Type:** whatever the docs theme ships. Do not buy a typeface for a v1.

---

# Part 2 — Repo bootstrap runbook

Prerequisites: Node 20+, pnpm 9+, git 2.40+, and push access to your GitHub
account. `base` must be pushed to `https://github.com/pankyada/base.git`
(already its `origin`) — a submodule needs a fetchable URL, so **commit and push
the harness branch you want to pin before starting.**

## Step 1 — Create the repo

```bash
mkdir -p ~/Desktop/development/mitra && cd ~/Desktop/development/mitra
git init -b main
```

Create the GitHub repo (private to start — it will hold config referencing your
accounts long before it holds secrets properly):

```bash
gh repo create pankyada/mitra --private --source=. --remote=origin
```

## Step 2 — Add `base` as a submodule

```bash
git submodule add https://github.com/pankyada/base.git vendor/base
git -C vendor/base checkout main          # or the exact commit you want pinned
git add .gitmodules vendor/base
git commit -m "chore: vendor base harness as submodule"
```

The submodule records a **specific commit**, not a branch. That is the pin from
ADR-57: Mitra always builds against a known harness revision, and upgrading is a
deliberate act (Step 8).

## Step 3 — Workspace wiring

`vendor/base` has its own `pnpm-workspace.yaml` listing `.`, `web`, and
`docs-site`. **pnpm does not nest workspaces** — the inner file is ignored once
the directory is part of an outer workspace, so the outer file must list every
package you actually need.

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "vendor/base"
  - "vendor/base/web"
```

Omit `vendor/base/docs-site` — Mitra does not build the harness's docs site, and
including it pulls a dependency tree you will never use.

`package.json`:

```jsonc
{
  "name": "mitra",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "setup": "git submodule update --init --recursive && pnpm install && pnpm --filter harness build",
    "build": "pnpm --filter harness build && pnpm -r --filter './packages/*' build",
    "dev": "pnpm --filter @mitra/cli dev",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "harness:pin": "git -C vendor/base rev-parse HEAD"
  }
}
```

`pnpm setup` is the one command a fresh clone needs. It exists because a plain
`pnpm install` on a fresh clone silently produces an empty `vendor/base` and a
confusing failure — the friction ADR-57 accepted and this script pays off.

## Step 4 — Depend on the harness

In `packages/mitra-core/package.json`:

```jsonc
{
  "name": "@mitra/core",
  "dependencies": { "harness": "workspace:*" }
}
```

`harness` is `base`'s own package name (`vendor/base/package.json`). The
`workspace:*` protocol resolves it to the submodule — no registry, no publish.

`vendor/base` compiles to `dist/`, so `pnpm --filter harness build` must run
before anything imports it. That is why it is in `setup` and `build`.

## Step 5 — Directory skeleton

```bash
mkdir -p packages/{mitra-core,mitra-cli,mitra-channels}/src \
         profiles \
         .agents/{channels,voice,skills,playbooks} \
         docs scripts
```

```
mitra/
  vendor/base/              submodule — never edit here, see Step 7
  packages/
    mitra-core/             config, secrets, pairing, dev-gate
    mitra-cli/              the `mitra` binary
    mitra-channels/         shared adapter helpers
  .agents/
    channels/telegram.ts    loaded by the harness (ADR-29)
    voice/                  STT/TTS providers (ADR-55)
    skills/                 daily-brief, inbox-triage, weekly-review, capture
    playbooks/personal/     stage→artifact bindings for life tasks
  profiles/
    assistant.yaml  brief.yaml  triage.yaml  money.yaml  dev.yaml
  mitra.config.yaml
  docs/  scripts/
```

The `.agents/` layout is not arbitrary — it is exactly what the harness's
four-level discovery (ADR-3) finds when the working directory is the repo root.
Nothing needs configuring for adapters and skills to be found.

## Step 6 — `.gitignore`

```gitignore
node_modules/
dist/
.env
.env.*
*.local.yaml
~/.mitra/          # documentation only; real state lives outside the repo
.DS_Store
```

Do **not** ignore `vendor/base` — the submodule pointer is tracked content.
Never commit real secrets; ADR/plan require keychain or an encrypted file, and
`mitra doctor` reports what is missing by name.

## Step 7 — Working across both repos

The submodule is a full checkout, so harness edits are possible from inside
Mitra — and that is exactly how the boundary erodes. Rule:

> **Harness changes are made in the `base` repo, committed and pushed there,
> then pinned here.** Never commit to `vendor/base` from inside Mitra.

A guard hook is worth the five minutes (`scripts/no-vendor-edits.sh`, wired as a
`pre-commit` hook): fail if `git diff --cached --name-only` contains anything
under `vendor/`.

When you do need to co-develop a harness change and a Mitra feature together:

```bash
cd vendor/base
git checkout -b feat/17-channels     # work here, commit here, push here
cd ../..
git add vendor/base                  # pins Mitra to the new harness commit
git commit -m "chore: pin base to feat/17-channels for channel adapter work"
```

## Step 8 — Upgrading the pin

```bash
cd vendor/base && git fetch origin && git checkout <commit-or-tag> && cd ../..
pnpm --filter harness build && pnpm test
git add vendor/base && git commit -m "chore: bump base to <short-sha> (#17 channels)"
```

Always run Mitra's tests before committing a bump — the pin is the only thing
protecting Mitra from a harness change, and a bump is the moment that protection
is spent.

## Step 9 — CI skeleton

`.github/workflows/ci.yml` must do three things a normal workflow does not:

```yaml
- uses: actions/checkout@v4
  with: { submodules: recursive }        # 1. or vendor/base is empty
- run: pnpm install --frozen-lockfile
- run: pnpm --filter harness build       # 2. harness compiles before use
- run: pnpm typecheck && pnpm test
- run: ./scripts/check-no-vendor-edits.sh # 3. boundary guard, Mitra side
```

The third is the mirror of `base`'s H0.1 guard: `base` proves no product
vocabulary leaked *in*, Mitra proves no harness edits leaked *out*.

## Step 10 — Verify

A fresh clone must reach a running CLI with no manual steps:

```bash
cd /tmp && git clone https://github.com/pankyada/mitra.git && cd mitra
pnpm setup
pnpm dev -- --help
```

Checklist before calling A1.1 done:

- [ ] fresh clone + `pnpm setup` succeeds with no manual submodule command
- [ ] `vendor/base` is at the intended commit (`pnpm harness:pin`)
- [ ] `@mitra/core` imports something from `harness` and typechecks
- [ ] pre-commit hook rejects a staged change under `vendor/`
- [ ] CI green, including the submodule checkout
- [ ] README states the two-repo model in the first screenful

---

## What comes next

Sprint A1 continues in the new repo: config schema + secrets vault (A1.2), the
`mitra` CLI (A1.3), and the onboarding wizard (A1.4) — the last of which is the
primary UX bet against openclaw and should be treated as a feature, not
scaffolding.

Nothing in Part B can be demoed until harness #17 (channels) lands, so the
practical order is: bootstrap this repo, then implement #17 in `base`, then pin
and build the Telegram adapter.
