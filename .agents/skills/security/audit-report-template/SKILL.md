---
name: audit-report-template
description: Markdown template for security audit finding reports. Write one file per commit SHA to .harness/security/reports/.
---

# Audit Report Template

Write findings to `.harness/security/reports/<commit_sha>.md`.

## Template

```markdown
# Security Audit Report

**Repo:** <repo_path>  
**Commit:** `<commit_sha>`  
**Date:** <YYYY-MM-DD>  
**Auditor:** security agent (claude-opus-4-8)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | N |
| High     | N |
| Medium   | N |
| Low      | N |

---

## Findings

### [SEV-001] <Short title>

**Severity:** Critical / High / Medium / Low  
**File:** `path/to/file.ts:42`  
**Pattern:** SQL Injection / Path Traversal / Hardcoded Secret / Unsafe Deserialization / Open Redirect

**Description:**  
One paragraph explaining what the issue is and why it is dangerous in this specific context.

**Evidence:**
```
exact code snippet from the file
```

**Recommendation:**  
A specific, actionable fix (e.g. "Replace string concatenation with `db.query($1, [id])` parameterised query.").

---

## Files Audited

- `src/...`
- `lib/...`

## Patterns Checked

- [ ] SQL Injection
- [ ] Path Traversal
- [ ] Hardcoded Secrets
- [ ] Unsafe Deserialization
- [ ] Open Redirects
```

## Rules

- One `###` section per finding. Never bundle two findings.
- File path must include the line number (`:42`).
- Evidence must be an exact quote from the file — never paraphrased.
- Recommendation must be specific and include corrected code or a command.
- If no findings for a pattern, mark it checked (✓) in the "Patterns Checked" section but do not create a finding entry.
