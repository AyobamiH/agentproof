---
schema: clawsweeper.project-vision.v1
project_id: agentproof
repository: AyobamiH/agentproof
---

# Project Vision

## Identity

AgentProof is a framework-neutral action-transaction and proof-of-outcome layer for coding agents, autonomous operators, and the organisations authorising their work.

## Purpose

Prove that a consequential agent action was the intended action, was properly authorised, happened once, produced the required target state, and can be recovered or escalated honestly. The first product wedge is a verified local repository patch exposed through portable CLI/SDK contracts.

## Owns

- Transaction-bound action preparation and authority contracts.
- Bounded repository-patch execution for the currently supported action.
- Approval binding, single-use authority, transaction identity, exactly-once behaviour, deterministic reconciliation, and compensation.
- Independent postcondition observation for its transaction outcome.
- Signed Receipt V2 formats, offline receipt verification, and explicit signer-trust decisions.
- Framework-neutral public contracts that adapters consume without making any one agent runtime the product boundary.

## Does Not Own

- Product-level orchestration, memory, scheduling, or a universal agent runtime.
- A dashboard, marketplace, connector catalogue, broad action set, or speculative platform surface without adoption evidence and an explicit decision.
- Production authority merely because a development signer exists.
- The claim that cryptographic validity alone proves an external effect.
- OpsTruth's independent verification role or DoneState's broader execution-control responsibilities.

## Non-Negotiable Invariants

- Proposer, approval authority, executor, receipt signer, and verifier remain distinct roles.
- Approval binds the exact transaction, intent, target, prepared state, policy, issuer, expiry, and nonce.
- Execution is idempotent and deterministic recovery fails closed on ambiguity.
- Verification re-observes resulting state rather than trusting executor output.
- Signer trust is explicit and separate from signature validity.
- Signed receipts are immutable; compensation creates a successor.
- Development authority never satisfies production policy.
- New actions are added only when adoption evidence justifies them.

## Evidence of Done

A protected action is complete only when the exact authorised transaction settles once, the required target state is independently re-observed, recovery/compensation state is honest, and the signed evidence validates under an explicitly trusted policy.

## Relationships

- openclaw-operator: first adapter and dogfood environment, not AgentProof's permanent source or product boundary.
- Proof & State: portfolio governance.
- DoneState: adjacent authorised execution control plane.
- OpsTruth: adjacent independent verification product.
- Within the Proof & State family, AgentProof is the consequential-action authorisation/receipt layer and downstream evidence layer for merge, deployment, package, and release effects.

## Canonical Sources

README.md, AGENTS.md, docs/PROJECT-DIRECTION.md, docs/PRODUCT-NORTH-STAR.md, SECURITY.md, docs/TRUST-MODEL.md, docs/CURRENT-STATUS.md, docs/ROADMAP.md, and docs/DECISION-LOG.md.

## Agent Rule

Preserve framework neutrality and role separation. Do not expand AgentProof into an agent framework or broad platform merely because an adjacent product needs a capability.
