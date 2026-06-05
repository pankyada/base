---
name: incident-runbook
description: Standard incident response runbook with escalation paths and remediation steps.
---

# Incident Runbook

## Severity levels

**P1 (Critical)** — Production outage, revenue impact. Page on-call immediately.
**P2 (High)** — Degraded service, customer-facing. Notify team lead.
**P3 (Medium)** — Internal tool down or performance issue. Create ticket.
**P4 (Low)** — Minor issues, documentation gaps. Log and schedule.

## Response steps

1. **Acknowledge** — Log incident start time, severity, impact scope.
2. **Assess** — Check metrics (CPU, memory, disk), recent deployments, error logs.
3. **Mitigate** — If safe: restart service, scale up, rollback bad deploy. If unsafe: page senior engineer.
4. **Resolve** — Fix root cause, validate stability, update runbook.
5. **Postmortem** — Write timeline, action items, follow-ups.

## Common incidents

- **OOM (Out of Memory)** — Check top consumers with `ps aux --sort=-%mem`. Scale up or kill leaking process.
- **Disk full** — `df -h`, identify largest dirs with `du -sh *`. Archive/delete or add storage.
- **High latency** — Check database query logs, API service error rates. Profile slow endpoints.
- **Deploy failure** — Check CI logs, rollback previous deploy, re-run with verbose flags.

## Escalation

- **Stuck > 10 min?** Page on-call.
- **Stuck > 30 min?** Page manager + tech lead.
- **Scope unclear?** Declare SEV2, notify comms team.
