# Verified repository patch v1

`agentproof.repository_patch.v1` is AgentProof’s first commercial coding-agent action because it turns a prepared multi-file change into independently verifiable repository evidence without granting commit, push, deployment, or remote authority.

## Safety boundary

V1 accepts one canonical, clean local Git repository at an exact branch and base commit. Every tracked path and approved new path is allowlisted. Regular files only are supported. The action rejects dirty trees, unresolved merges, detached HEADs, symlinks, gitlinks/submodules, path escapes, `.git/**`, undeclared files, case-folding collisions, secret-bearing paths or proposed secret-like content, changed repository identity, and before-state drift.

The prepared patch is a canonical, binary-safe JSON operation list containing base64 file bytes or exact deletions. Its SHA-256 digest, affected paths, before/after manifests, base commit, branch, repository metadata digests, verification plan, expected canonical result digest, policy version, expiry, and nonce are bound into the canonical Operator approval record and replay decision.

## Execution and verification

Mutation runs in the existing separate Node executor process. It receives only the repository root, prepared patch, path set, and before/after hashes. It cannot approve, sign, commit, push, alter Git configuration, or access remotes.

The parent process independently reads Git identity, status, file modes and bytes. Verification proves the exact manifest, exact changed-path set, unchanged commits/refs/remotes, and absence of unexpected untracked files. Optional commands are executable-plus-argument arrays with allowlisted executable and working directory, timeout, and output cap. They run in a disposable copy; receipts retain exit state, duration, byte counts, truncation flag, and stdout/stderr digests—not raw output.

Compensation restores captured bytes and modes path-by-path without `git reset --hard`, deletes only approved new files, then requires a clean tree and the original repository identity.

## Approval payload

The `agentProof` payload uses schema `agentproof.repository-patch.approval.v1` and binds transaction, intent/action digests, canonical root, base commit, branch, before/proposed manifest digests, patch and expected-diff digests, affected paths, verification-plan digest, policy version, issuer decision linkage, expiry, and single-use nonce.

## Receipt

The signed `agentproof.repository-patch.receipt.v1` contains Operator authority identities, transaction and repository identity, manifests, approved/observed paths, patch/result digests, verification-command evidence, execution/verification/compensation states, failures, reconciliation evidence, and an Ed25519 signer fingerprint. Offline trust requires an explicitly pinned fingerprint; an embedded public key is not identity.

## Unsupported

Commits, pushes, tags, branch deletion, remote operations, shell command strings, submodules, symlinks, arbitrary untracked-file changes, and modification of real project repositories are unsupported.

## Local harness

Build AgentProof, then run the repository-patch harness test from `orchestrator`:

```sh
npm --prefix agentproof run build
cd orchestrator
npx vitest run test/agentproof-repository-patch.test.ts --reporter=verbose
```

All harness repositories, SQLite databases, and signing keys are temporary.
