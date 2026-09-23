---
schema: clawsweeper.project-vision.v1
project_id: agentproof
repository: AyobamiH/agentproof
---

# Project Vision

## Identity

AgentProof is a standalone execution-and-evidence protocol for authorised repository changes with exactly-once semantics, deterministic recovery, independent postcondition verification, and signed receipts.

## Purpose

Make consequential agent actions reviewable and independently verifiable by binding approval to an exact prepared state, separating authority roles, recording execution deterministically, and producing receipts that can be checked offline.

## Owns

- Prepared action contracts and bounded repository-patch execution.
- Approval binding, transaction identity, exactly-once behaviour, reconciliation, and compensation.
- Signed receipt formats and offline receipt verification.
- Trust-role separation for proposer, authority, executor, signer, and verifier.

## Does Not Own

- Product-level orchestration for OpenClaw Operator.
- A universal agent runtime or scheduler.
- A production authority merely because a development signer exists.
- The claim that a valid signature alone proves an external outcome.

## Non-Negotiable Invariants

- Approval separation is preserved.
- Exactly-once execution and deterministic reconciliation fail closed on ambiguity.
- Signer trust is explicit and separate from cryptographic validity.
- Independent postcondition verification is distinct from execution.
- Unsupported actions or product surfaces are not added without evidence and an explicit decision.
- Development authority never satisfies production authority policy.

## Evidence of Done

A protected action is complete only when the exact authorised transaction settles, the expected state is independently re-observed, and the resulting signed evidence validates under the intended trust policy.

## Relationships

- openclaw-operator: first adapter/dogfood environment, not AgentProof's source boundary.
- Proof & State: portfolio governance.
- DoneState and OpsTruth: adjacent products with different execution/verification responsibilities.

## Canonical Sources

README.md, AGENTS.md, docs/PROJECT-DIRECTION.md, SECURITY.md, docs/TRUST-MODEL.md, docs/PRODUCT-NORTH-STAR.md, and docs/CURRENT-STATUS.md.

## Agent Rule

Do not collapse proposer, approver, executor, signer, and verifier into one authority. Preserve the protocol boundary even when a shortcut would make a demo easier.
