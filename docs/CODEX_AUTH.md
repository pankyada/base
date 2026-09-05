# Codex subscription authentication (experimental)

Base supports explicit Codex subscription authentication alongside its existing API-key providers. API keys remain the default. No Claude subscription authentication is included.

This implementation follows OpenCode's direct OAuth and Codex Responses approach while Base continues to own tool execution, approvals, hooks, session history, and delegation. It does not launch Codex CLI or import another application's credentials.

## Sign in

From an installed CLI:

```sh
harness auth login openai --method browser
harness auth status openai --json
```

Browser authentication uses PKCE and a loopback callback at `http://localhost:1455/auth/callback`. If browser launch fails, the CLI prints the authorization URL and continues waiting. Keep the CLI running until it reports success. A busy callback port produces an error; close the conflicting login listener and retry.

For a machine without a browser:

```sh
harness auth login openai --method device
```

Open the displayed verification page on another device and enter the displayed code. Base exchanges the approved handoff for credentials; the device approval itself is not the final token.

Credentials belong to the operating-system account running Base. They are stored separately from profiles and API keys in `~/.harness/auth/openai-codex.json`, with private directory/file permissions on Unix. Refresh is serialized across local processes. Do not copy this file into profiles, project repositories, shared artifacts, or browser storage. Windows ACL and process-lock acceptance remain pending.

## Select a profile

Use the existing `harness init` provider choice, or explicitly configure a profile:

```yaml
model:
  auth: codex_oauth
  id: gpt-5.4-mini
  codex:
    max_model_calls_per_run: 64
    request_timeout_ms: 120000
```

Only source-validated entries in the Codex model catalog are selectable. The initial catalog contains `gpt-5.4-mini`; this is not a promise that every subscription can access it. Any role, fallback, classifier, digest, or improvement model override in this profile must also use a catalog-supported model. `harness init` previews required override changes before confirmation.

Do not set `base_url` or `api_key_env` for a Codex profile. OAuth tokens are accepted only by the fixed Codex transport, never by arbitrary OpenAI-compatible endpoints. An unavailable subscription, expired login, quota error, or unsupported model does not trigger paid API fallback.

Existing API profiles need no change. Omitting `model.auth` selects `api_key`, preserves ambient environment precedence, and retains the current endpoint and key handling. Switching profiles uses the existing profile selector. An explicitly selected API-key child profile uses API billing even if its parent uses Codex.

## Usage and limits

Codex token costs displayed by Base are **API-equivalent estimates**, not subscription charges or invoices. API profiles display API estimates. Mixed runs retain separate subtotals and an aggregate estimate. Actual billed cost is unknown. Subscription allowance and API credits are distinct.

The root attempt limit includes helpers, delegated model calls, and inference retries. The Codex default is 64 attempts, configurable from 1 to 1024. Request timeout defaults to 120 seconds; caller cancellation and tighter run deadlines take precedence. Base allows two concurrent Codex calls per process. Explicit transient rejections can retry within the same limits; ambiguous interrupted generations are not automatically replayed.

When an accepted request has incomplete usage, Base retains a conservative estimate using estimated input plus the model's maximum output bound. This can be much higher than actual consumption. It avoids treating an interrupted request as free, and can exhaust a dollar-estimate budget. Starting another run does not reset provider-side subscription limits.

## Logout and diagnostics

```sh
harness auth logout openai
harness auth status openai
```

Logout invalidates Base's local credential generation and leaves API keys unchanged. Tools returned under an old credential generation cannot execute after logout or account replacement. Completed history can be translated for a later model/account without forwarding its old opaque continuation. Pending old tool calls require a fresh session.

Set `HARNESS_DISABLE_CODEX_OAUTH=1` to disable this transport. Select an API-key profile explicitly to use API keys. The existing doctor command checks local credential status without network access unless a live check is requested.

For developers:

```sh
pnpm exec tsx scripts/probe-codex.ts --mock
# Explicitly consumes subscription allowance after login:
pnpm exec tsx scripts/probe-codex.ts --live --model gpt-5.4-mini
```

The mock probe validates the transport shape and a synthetic tool-result continuation. It does not prove account access or billing. Review [compatibility evidence and live checklist](superpowers/reports/codex-compatibility.md) before treating this as live-accepted. Personal use does not itself establish provider authorization or guarantee client-registration compatibility.
