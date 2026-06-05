---
name: rollback-checklist
description: Pre-rollback validation checklist and post-rollback verification steps.
---

# Rollback Checklist

## Before rollback

- [ ] Confirm bad commit/version causing outage (git log, release notes)
- [ ] Identify target rollback version (test vs prod version tags)
- [ ] Check if previous version was tested in staging
- [ ] Notify on-call manager — rolling back, ETA 15 min
- [ ] Tag current broken version for post-mortems
- [ ] Backup current config/database state if rolling back database migrations

## Execute rollback

```bash
git checkout <target-version-tag>
pnpm build
pnpm deploy --env production
```

Or if using container registry:
```bash
docker pull registry/service:previous-stable
docker push registry/service:latest
# trigger rollout in k8s / ECS / VM fleet
```

## Verify after rollback

- [ ] Service health checks pass (200 OK on `/health`)
- [ ] No new errors in application logs (check last 2 min)
- [ ] Customer traffic flowing, latency < baseline
- [ ] Database consistency verified (run integrity checks)
- [ ] Notify team: rollback complete, monitoring

## Post-incident

- [ ] Create incident ticket with timeline
- [ ] Schedule postmortem for next business day
- [ ] Add monitoring/alerts to catch regression earlier
- [ ] Review code change that caused issue — why did it pass tests?
