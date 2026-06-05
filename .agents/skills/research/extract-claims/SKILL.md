---
name: extract-claims
description: Validate and structure factual claims extracted from web sources. Each claim must have a source URL, a direct quote, and a confidence score.
---

# Extract Claims

Use this skill to validate that the researcher's findings are correctly structured before passing them to the summariser.

## Required shape for each finding

```json
{
  "claim": "A specific, falsifiable statement in one sentence",
  "source": "https://full-url-of-the-source-page",
  "quote": "The exact sentence(s) from the source that support this claim",
  "confidence": "high | medium | low"
}
```

## Confidence levels

| Level | When to use |
|-------|-------------|
| `high` | Claim is stated explicitly and verbatim in the source |
| `medium` | Claim is a close paraphrase or summarisation of source text |
| `low` | Claim is inferred from context; must be flagged to the orchestrator |

## Validation rules

1. **One claim per object.** Split compound claims (e.g. "X is Y and also Z") into separate entries.
2. **Source must be a URL.** Discard claims with no traceable URL.
3. **Quote must be non-empty.** A missing quote means the claim is unverified — mark `confidence: low` or discard.
4. **No hallucinated sources.** If you cannot locate a quote in the fetched content, drop the claim entirely.

## Rejection template

If findings are malformed, return this to the orchestrator:

```
FINDINGS INVALID: <reason>
Expected format: [{ claim, source, quote, confidence }]
Problematic entries: <list>
```
