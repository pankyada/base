---
name: vuln-patterns
description: Grep signatures for common vulnerability patterns — SQL injection, path traversal, hardcoded secrets, unsafe deserialization, open redirects. Use with the Grep tool during code audits.
---

# Vulnerability Patterns

Use these patterns with the `Grep` tool or `codebase` MCP (`read_file` + manual scan).

## 1. SQL Injection (default severity: critical)

```
grep -rn "execute\|\.query(\|\.raw(" --include="*.ts" --include="*.js" --include="*.py" <path>
```

**Signs:** User input concatenated into SQL — `"SELECT … " + req.body.id`, `` `SELECT … ${userInput}` ``, `f"SELECT … {user}"`.  
**Safe patterns:** parameterised queries — `db.query('SELECT … WHERE id=$1', [id])`, `cursor.execute("… %s", (val,))`.

## 2. Path Traversal (default severity: high)

```
grep -rn "readFile\|open(\|\.join(" --include="*.ts" --include="*.js" --include="*.py" <path>
```

**Signs:** Unsanitised user input in file path argument — look for missing `path.resolve` / `os.path.abspath`, or `../` not stripped.

## 3. Hardcoded Secrets (default severity: high)

```
grep -rni "password\s*=\s*['\"].\|secret\s*=\s*['\"].\|api_key\s*=\s*['\"].\|token\s*=\s*['\"]." --include="*.ts" --include="*.js" --include="*.py" --include="*.yaml" <path>
```

**Signs:** String literal value rather than `process.env.X` or `os.environ["X"]`.

## 4. Unsafe Deserialization (default severity: high)

```
# JS/TS
grep -rn "eval(\|new Function(\|vm\.runInNewContext\|\.unserialize(" --include="*.ts" --include="*.js" <path>

# Python
grep -rn "pickle\.loads\|yaml\.load(" --include="*.py" <path>
```

**Signs for Python:** `yaml.load(data)` without `Loader=yaml.SafeLoader` is unsafe.

## 5. Open Redirect (default severity: medium)

```
grep -rn "res\.redirect\|location\.href\s*=\|window\.location\s*=" --include="*.ts" --include="*.js" <path>
```

**Signs:** Redirect target contains unsanitised user input from query params or request body.

## Severity guide

| Pattern | Default severity |
|---------|-----------------|
| SQL Injection | critical |
| Path Traversal | high |
| Hardcoded Secret | high |
| Unsafe Deserialization | high |
| Open Redirect | medium |

Downgrade to `low` if the code path is unreachable in production. Upgrade to `critical` if the endpoint is publicly exposed and unauthenticated.
