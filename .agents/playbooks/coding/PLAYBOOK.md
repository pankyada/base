---
name: coding
description: Use for software changes, including investigating, designing, implementing, or debugging code and configuration. Not for structured data analysis, evidence-led research, security assessments, or standalone prose work.
stages: [recon, plan, design, build, verify, review]
task_classes: [ui-tweak, bugfix, feature, refactor, migration, spike, investigation]
defaults:
  ui-tweak: { recon: 1, plan: 0, design: 0, build: 2, verify: 1, review: 1 }
  bugfix: { recon: 1, plan: 1, design: 0, build: 2, verify: 2, review: 1 }
  feature: { recon: 2, plan: 2, design: 2, build: 2, verify: 2, review: 1 }
  migration: { recon: 3, plan: 3, design: 3, build: 2, verify: 3, review: 3 }
  refactor: { recon: 2, plan: 2, design: 2, build: 2, verify: 2, review: 2 }
---

## recon
### L1
Required artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.
Exit criteria: every touched file inspected and project graph queried.
### L2
Required artifact sections: `Files touched`, `Callers`, `Existing tests`, `Prior knowledge`, `Open questions`.
Exit criteria: callers and current coverage recorded.
### L3
Required artifact sections: `Files touched`, `Callers`, `Existing tests`, `Git archaeology`, `Prior knowledge`, `Contradictions`, `Open questions`.
Exit criteria: prior decisions and contradictions recorded.

## plan
### L1
Required artifact sections: `Plan`, `Risks`.
Exit criteria: steps and risks explicit.
### L2
Required artifact sections: `Plan`, `Files`, `Risks`, `Rollback`.
Exit criteria: implementation path and rollback explicit.
### L3
Required artifact sections: `Plan`, `Alternatives`, `Tradeoffs`, `Risks`, `Rollback`.
Exit criteria: alternatives compared.

## design
### L1
Required artifact sections: `Design`.
Exit criteria: output contract sketched.
### L2
Required artifact sections: `Interfaces`, `Schema`, `Migration`.
Exit criteria: contract fixed before build.
### L3
Required artifact sections: `Interfaces`, `Contract tests`, `Migration`, `Backout`.
Exit criteria: contract and backout path explicit.

## build
### L1
Required artifact sections: `Result`.
Exit criteria: patch produced.
### L2
Required artifact sections: `Result`, `Invariants`.
Exit criteria: patch and invariants stated.
### L3
Required artifact sections: `Result`, `Invariants`, `Green checkpoints`.
Exit criteria: staged work independently green.

## verify
### L1
Required artifact sections: `Verification`.
Exit criteria: existing checks run.
### L2
Required artifact sections: `Verification`, `Changed branches`.
Exit criteria: changed branches have coverage.
### L3
Required artifact sections: `Verification`, `Adversarial cases`, `Edge cases`.
Exit criteria: adversarial checks pass.

## review
### L1
Required artifact sections: `Review`.
Exit criteria: self-diff read.
### L2
Required artifact sections: `Review`, `Findings`, `Generalization`.
Exit criteria: critic review and scope probe recorded.
### L3
Required artifact sections: `Review`, `Findings`, `Security pass`, `Generalization`.
Exit criteria: second model and security review recorded.
