---
name: agentproof
description: Use AgentProof for approval-bound repository patches with explicit authority, exactly-once execution, independent verification, deterministic recovery, and signed receipts.
version: 1.0.0
metadata: {"openclaw":{"requires":{"bins":["agentproof"]},"homepage":"https://github.com/AyobamiH/agentproof"}}
---

# AgentProof

Use this skill only when the user wants a consequential repository change to pass through AgentProof's authorization and evidence protocol, or when they want to inspect, reconcile, compensate, or verify an existing AgentProof transaction or receipt.

AgentProof is not a generic code-editing shortcut. It protects one current action contract: `agentproof.repository_patch.v1`.

## Safety contract

- Require an explicit target repository, intended change, allowed paths, and acceptance criteria before preparing a transaction.
- Never fabricate an approval, authority signature, trust fingerprint, receipt key, nonce, or authority decision.
- A prepared transaction is not approval. An approval request is not approval. Stop at the authority boundary until a valid signed decision is available.
- Never use `agentproof-dev-authority` to authorize real, consequential, or production work. Development authority is only for disposable demonstrations and tests.
- Do not widen the allowlisted repository root, tracked paths, new paths, file count, or byte limits to make a blocked change pass.
- Do not silently retry failed execution by creating a fresh transaction. Inspect status and use the protocol's reconciliation path so exactly-once semantics are preserved.
- Use compensation only as an explicit recovery action with the required trust and authority inputs. Do not treat compensation as an ordinary undo command.
- Preserve generated JSON documents and signed receipts as evidence. Do not rewrite them to make a result look successful.

## Prerequisite

The AgentProof CLI is currently a developer-preview package. This ClawHub skill intentionally does not auto-install the product code. Install AgentProof from the project's documented immutable release or source-consumption path, then ensure `agentproof` is on `PATH`.

Confirm the available contract before doing anything consequential:

```bash
agentproof --help
```

## Transaction workflow

### 1. Prepare

Build or receive a valid repository-patch request document that binds the exact repository root, operations, intent, policy, correlation ID, and state directory. Then run:

```bash
agentproof prepare repository-patch --input request.json > prepared.json
```

Review the prepared document before continuing. If it does not match the user's intended bytes and policy, stop.

### 2. Create the approval request

Use an explicit expiry and nonce:

```bash
agentproof approval-request \
  --input prepared.json \
  --expires-at <ISO_TIMESTAMP> \
  --nonce <NONCE> \
  > approval-request.json
```

At this point, stop unless a legitimate authority mechanism supplies the signed approval needed for execution. Do not self-approve.

### 3. Execute an approved transaction

Only after a valid execution-request document exists and the required receipt-signing key path is explicitly available:

```bash
agentproof execute \
  --input execution-request.json \
  --receipt-key <private-key.pem> \
  > receipt.json
```

Do not invent the execution request or signer material.

### 4. Verify the receipt independently

Use the trusted signer fingerprint supplied by the operator or authority configuration:

```bash
agentproof verify-receipt \
  --input receipt.json \
  --trust-fingerprint <sha256:...>
```

For production-authority evidence, require the expected environment when appropriate:

```bash
agentproof verify-receipt \
  --input receipt.json \
  --trust-fingerprint <sha256:...> \
  --required-authority-environment production
```

A successful mutation is not enough. Report separately whether execution completed, the receipt is cryptographically valid, and the signer is trusted.

## Recovery workflow

Inspect an existing transaction before attempting recovery:

```bash
agentproof status --input status-query.json
```

If execution state is ambiguous, use reconciliation rather than starting over:

```bash
agentproof reconcile \
  --input reconciliation-query.json \
  --receipt-key <private-key.pem>
```

Use compensation only when explicitly required and when all trust inputs are available:

```bash
agentproof compensate \
  --input status-query.json \
  --receipt-key <private-key.pem> \
  --trust-fingerprint <sha256:...> \
  --authority-environment <development|production>
```

## Reporting standard

Always distinguish these states instead of collapsing them into "done":

- request constructed;
- transaction prepared;
- approval requested;
- authority approval verified;
- execution attempted;
- repository state verified;
- receipt emitted;
- receipt cryptographically valid;
- signer trusted;
- recovery or compensation required.

If any required authority, key, fingerprint, repository state, or receipt evidence is missing, say that it is missing and stop at the appropriate boundary.
