---
name: data
description: Reproducible data workflow
stages: [recon, plan, design, build, verify, review]
task_classes: [analysis, report, transform]
defaults:
  analysis: { recon: 1, plan: 1, design: 1, build: 2, verify: 2, review: 1 }
---

## recon
### L1
Required artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.
Exit criteria: schema, row counts, and nulls recorded.
## plan
### L1
Required artifact sections: `Plan`, `Query strategy`, `Risks`.
Exit criteria: joins and transformations planned.
## design
### L1
Required artifact sections: `Design`, `Metrics`, `Join keys`.
Exit criteria: metric definitions fixed.
## build
### L1
Required artifact sections: `Result`.
Exit criteria: queries or transforms produced.
## verify
### L1
Required artifact sections: `Verification`, `Reconciliation`.
Exit criteria: totals and sanity checks reconcile.
## review
### L1
Required artifact sections: `Review`, `Generalization`.
Exit criteria: assumptions reviewed.
