---
name: security
description: Reproducible security review workflow
stages: [recon, plan, design, build, verify, review]
task_classes: [audit, finding, repro]
defaults:
  audit: { recon: 2, plan: 2, design: 1, build: 2, verify: 2, review: 2 }
---

## recon
### L1
Required artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.
Exit criteria: asset and scope inventory recorded.
## plan
### L1
Required artifact sections: `Plan`, `Rules of engagement`, `Risks`.
Exit criteria: test plan explicit.
## design
### L1
Required artifact sections: `Design`, `Finding template`, `Severity rubric`.
Exit criteria: finding contract fixed.
## build
### L1
Required artifact sections: `Result`.
Exit criteria: probe or repro produced.
## verify
### L1
Required artifact sections: `Verification`, `Reproduction`.
Exit criteria: finding reproduced or false positive explained.
## review
### L1
Required artifact sections: `Review`, `Blast-radius check`, `Generalization`.
Exit criteria: peer review complete.
