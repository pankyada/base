# Codex compatibility evidence

Updated 2026-09-06. Experimental implementation; no live account acceptance recorded.

## Source evidence

- OpenCode revision: [`e2894562f8ba943d72172d10b727c24d5f650c16`](https://github.com/anomalyco/opencode/tree/e2894562f8ba943d72172d10b727c24d5f650c16).
- [Codex auth plugin](https://github.com/anomalyco/opencode/blob/e2894562f8ba943d72172d10b727c24d5f650c16/packages/opencode/src/plugin/openai/codex.ts): candidate client registration, fixed loopback redirect, device-code handoff followed by OAuth exchange, token refresh and account header routing.
- [Provider selection](https://github.com/anomalyco/opencode/blob/e2894562f8ba943d72172d10b727c24d5f650c16/packages/opencode/src/provider/provider.ts): Responses-model selection is separate from OAuth. Base therefore needs a Responses serializer and stream decoder, not merely a different bearer value on Chat Completions.
- [Official GPT-5.4 mini model reference](https://developers.openai.com/api/docs/models/gpt-5.4-mini), checked 2026-09-06: 400,000 context tokens; 128,000 maximum output tokens; reasoning efforts none, low, medium, high and xhigh; reference API token prices $0.75 input and $4.50 output per million. These are API model reference properties, not proof of subscription account entitlement or backend option support.

Base identifies itself as Base/Harness. No OpenCode identity spoofing, Codex credential import, account pooling or subscription-limit bypass is included. Client registration compatibility remains an operator-run acceptance gate.

## Mock evidence

`pnpm exec tsx scripts/probe-codex.ts --mock` passed on 2026-09-06: three
requests completed text generation, a validated synthetic function call and its
stateless result continuation. No live credentials or external network used.
The report deliberately returns `billing_verified: false`.

Tests use disposable home directories and synthetic credentials. Browser callbacks exercise a real loopback HTTP listener with a mocked issuer. Device tests exercise the code handoff and final exchange. Credential tests include three concurrent child processes, canceled lock waiters, malformed replacement preservation, invalid grant and stalled response bodies. Stream fixtures include split UTF-8, malformed executable arguments, terminal failures, refusal and duplicate completion snapshots.

Mock counts and final runtime regression results belong in the implementation acceptance report. Passing mocked tests does not establish authentication success, model quality or provider-side subscription billing.

## Live acceptance checklist

Still pending:

1. Operator signs in through `harness auth login openai --method browser` or `--method device` using Base-owned storage.
2. Record accepted client/redirect, sanitized provider identity and model. Never save raw tokens, authorization codes or private encrypted reasoning into this report.
3. Run one short text request and one Base-owned tool call/result round trip, followed by a stateless follow-up with continuation.
4. Confirm helper and delegated profiles use the intended transport and no API-key endpoint is contacted by a Codex-only run.
5. Check provider-side subscription usage where attribution is available. Record uncertainty if a small test cannot be attributed; local API-equivalent estimates are not invoices.
6. Verify logout, restart/reconnect and reconnect-required behavior. Windows callback launch, filesystem ACLs and process-lock behavior require separate Windows acceptance.

No deployment, live login, live inference or account billing inspection has been performed during the implementation work recorded so far.
