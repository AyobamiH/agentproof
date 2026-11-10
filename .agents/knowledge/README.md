
<!-- agent-foundations:begin -->
# AgentProof agent knowledge

Follow the reading and authority order in [AGENTS.md](../../AGENTS.md). Start with [project direction](../../docs/PROJECT-DIRECTION.md), [security](../../SECURITY.md), [trust model](../../docs/TRUST-MODEL.md), and [architecture](../../docs/ARCHITECTURE.md).

## Source map and scope

The supported repository-patch path is implemented in [repository-patch-service.ts](../../src/repository-patch-service.ts), with a separate [executor](../../src/repository-patch-executor.ts) and [store](../../src/repository-patch-store.ts). [receipt-v2.ts](../../src/receipt-v2.ts), [signer.ts](../../src/signer.ts) and [schemas](../../schemas/) define receipt and trust surfaces. Existing specialised [AgentProof skills](../../skills/agentproof/) complement the secure delivery skill.

Preserve transaction-bound approvals, explicit signer pins, single-use execution and independent observation. Development authority is not production authority. A source-only release candidate is not an enabled production action. Consult [current status](../../docs/CURRENT-STATUS.md) and [roadmap](../../docs/ROADMAP.md) for the evidence and gates rather than copying mutable status here.

## Setup and validation

[CONTRIBUTING.md](../../CONTRIBUTING.md) specifies `npm ci`, `npm run typecheck`, `npm test`, `npm run pack:audit` and `git diff --check`. [package.json](../../package.json) requires Node.js 22.5+ and additionally defines `npm run docs:check` and `npm run check`. Foundation-only validation is `python3 .agents/validate_foundations.py` (Python 3 standard library). Publication still follows [the npm release procedure](../../docs/NPM-RELEASE.md).

## Existing lessons

[Security](../../SECURITY.md) documents why RC1 receipts are untrusted legacy evidence and why a self-consistent embedded key is not signer identity. The [decision log](../../docs/DECISION-LOG.md) and [historical evidence](../../docs/evidence/) preserve rationale. Automated tests and maintainer dogfooding are not independent adoption.

Update the relevant knowledge and its authoritative source in the same change when architecture, behaviour, commands or boundaries change. Preserve verified lessons and decision rationale, not raw chat transcripts, secrets or unverified live status. Link to authoritative records rather than maintaining competing copies.
<!-- agent-foundations:end -->
