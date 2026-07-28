# Contributing

Read `AGENTS.md` and the documents it names before proposing a change.

Keep changes bounded to an evidence-backed milestone. Security-sensitive changes require focused adversarial tests in addition to the complete test suite. New actions require measured adoption evidence and their own action contract; convenience must not weaken approval binding, idempotency, independent verification, signer trust, or append-only receipt history.

Before submitting work, run:

```sh
npm ci
npm run typecheck
npm test
npm run pack:audit
git diff --check
```

Do not commit credentials, private signing keys, mutable state, databases, logs, generated validation results, or machine-specific paths. Security reports should follow `SECURITY.md`.
