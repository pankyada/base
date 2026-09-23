---
name: generic
description: Use for requests that do not clearly fit a specialized workflow, including general questions, coordination, and small mixed tasks. Not for focused software changes, structured data analysis, research, security review, or document drafting.
stages: [recon, plan, build, verify]
task_classes: [general]
defaults:
  general: { recon: 1, plan: 1, design: 0, build: 2, verify: 1, review: 0 }
---

## recon
### L1
Required artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.
Exit criteria: current state inspected before planning.

## plan
### L1
Required artifact sections: `Plan`, `Risks`.
Exit criteria: sequence and risks explicit.

## build
### L1
Required artifact sections: `Result`.
Exit criteria: requested artifact produced.

## verify
### L1
Required artifact sections: `Verification`.
Exit criteria: result checked against reality.
