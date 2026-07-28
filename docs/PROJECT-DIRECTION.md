# Project direction

AgentProof is a framework-neutral action transaction and proof-of-outcome layer for coding agents, autonomous operators, and the organisations authorising their work.

Its first commercial wedge is a verified local repository patch: an agent prepares an exact change, receives transaction-bound authority, executes it exactly once, independently verifies repository state, compensates where possible, and issues a signed receipt. Developers adopt the portable CLI/SDK; agent platforms and enterprises are the expected buyers of production authority, shared policy, verification, and evidence retention.

## What is proven

The local `agentproof.repository_patch.v1` lifecycle, durable SQLite state, approval replay protection, separate executor, deterministic reconciliation, independent verification, Receipt V2, append-only compensation successors, CLI/SDK package, and development-authority separation have passed automated and isolated agent validation. RC5 moves that unchanged capability into its standalone source boundary. It remains an unpublished prerelease pending one exact external approval.

## Non-negotiable boundaries

- The proposer cannot grant approval.
- Approval binds the exact transaction, intent, action, target, prepared hashes, policy, issuer, expiry, and single-use nonce.
- Execution is idempotent and occurs outside the verifier/signer boundary.
- Verification observes resulting state rather than trusting executor output.
- Receipt trust requires an explicitly trusted signer fingerprint.
- Signed receipts are immutable; compensation creates a successor.
- Development authority never satisfies production policy.

## Now and next

Finish the standalone public prerelease, then measure ten independent agent installations and successful verified repository changes. Repair portability and documentation defects found through adoption. The next security milestone is a production authority/signing provider. Add one more action only when usage evidence demands it.

Do not build a dashboard, payments, marketplace, broad agent operating system, connector catalogue, MCP directory, or speculative action set yet. OpenClaw is the first adapter and dogfood environment, not the product boundary.

Evidence changes the roadmap: record observed adoption, failures, security findings, and decision consequences in [Adoption validation](ADOPTION-VALIDATION.md), [Current status](CURRENT-STATUS.md), and the [Decision log](DECISION-LOG.md), then adjust [Roadmap](ROADMAP.md). Never rewrite historical evidence.

Further authority: [Product north star](PRODUCT-NORTH-STAR.md), [Architecture](ARCHITECTURE.md), [Trust model](TRUST-MODEL.md), [Security](../SECURITY.md), [research rationale](research/ai-agent-market-research-2026.md), and [RC1–RC4 evidence](evidence/rc1-to-rc4-validation-summary.md).
