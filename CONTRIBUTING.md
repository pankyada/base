# Contributing to Base

Base is generic, profile-driven runtime infrastructure. Product-specific
behavior belongs in profiles, adapters, skills, or a consuming application—not
in `src/`.

## Before opening a pull request

1. Read the [architecture guide](docs-site/architecture.md) and relevant ADRs.
2. Keep each change narrow and add or update tests first.
3. Do not commit `.env`, generated build output, local runtime state, or keys.
4. Run the full local gate:

```bash
pnpm typecheck
pnpm test
bash scripts/check-boundary.sh
cd tui && GOCACHE=/tmp/base-go-cache go test ./...
```

## Pull requests

Explain the problem, the changed boundary, validation evidence, and any
operator-facing behavior. Keep unrelated formatting or generated-file churn
out of the diff. Security-sensitive changes should follow [SECURITY.md](SECURITY.md).
