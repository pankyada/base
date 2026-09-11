# Core cancellation boundary fix

Date: 2026-09-11 (Australia/Sydney). Narrow S6 fix for subprocess and hook
cancellation. No tracker or server/index changes.

## Scope and behavior

- `Bash` checks an already-aborted `ToolContext.signal` before spawning. On
  POSIX it runs detached and terminates the owned process group with TERM then
  KILL after a bounded 250 ms fallback; cancellation and timeout resolve only
  after process close or fallback and force SIGKILL on close. It returns the
  existing explicit result styles (`[cancelled]` / `[timeout after ...]`).
  Normal non-zero errors remain `Exit <code>` results.
- Hook commands use the same bounded detached process-group cleanup. Abort logs
  a cancellation diagnostic and stops the hook sequence; timeout and non-zero
  error diagnostics remain distinct. Captured stdout/stderr are each bounded at
  1 MiB, matching the prior `exec` max-buffer limit.
- Agent-loop and artifact-generator hook call sites pass `signal ??
  context.signal`. Normal MCP tool wrappers pass `ToolContext.signal` into the
  MCP SDK `callTool` request options. Poll probes now receive a trigger-owned
  signal, abort it during `PollTrigger.stop()`, and pass it through the server's
  MCP poll call.

## Tests

The new `tests/core-cancellation.test.ts` was run before the fix and failed all
3 initial cases: Bash and hooks timed out at 5 seconds, while MCP showed the
missing request options. After the fix:

```text
pnpm exec vitest run tests/core-cancellation.test.ts tests/hooks.test.ts tests/poll-trigger.test.ts --no-file-parallelism
Test Files 3 passed; Tests 15 passed.
```

The cancellation fixture waits for a child PID sentinel, aborts, verifies the
owned child no longer responds to `kill(pid, 0)`, and confirms no late marker
write. It also verifies pre-aborted Bash does not spawn and hooks do not start
the later command. Existing Bash/agent-loop behavior remains covered by the
focused suite.

`pnpm typecheck` and `pnpm build` passed after the fix. Full suite/build
must be rerun by the parent after all parallel Core edits freeze.

## Limits

POSIX process groups are cleaned as a unit. Windows uses direct child
termination because negative process-group signals are unavailable there;
Windows descendant cleanup remains an external platform gate. A process that
has already performed an irreversible external side effect before abort cannot
be rolled back; cancellation prevents owned local continuation and reports the
interruption.

Poll cancellation covers the normal server-owned trigger path. Probe
implementations that ignore the optional signal can still perform irreversible
remote work; the trigger suppresses late cursor/fire dispatch after stop but
cannot undo an already-started external operation.
