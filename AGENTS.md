# AgentProof agent instructions

Before changing this repository, read in order:

1. `docs/PROJECT-DIRECTION.md`
2. `SECURITY.md`
3. `docs/CURRENT-STATUS.md`
4. `docs/ROADMAP.md`
5. the relevant document under `docs/actions/` or `docs/protocols/`

Authority order:

1. Implemented behaviour: code, schemas, and passing tests.
2. Security boundaries: `SECURITY.md` and `docs/TRUST-MODEL.md`.
3. Product direction: `docs/PROJECT-DIRECTION.md` and `docs/PRODUCT-NORTH-STAR.md`.
4. Current priorities: `docs/ROADMAP.md` and `docs/CURRENT-STATUS.md`.
5. Historical rationale: `docs/research/` and `docs/evidence/`.

Fail closed when these sources contradict one another. Preserve approval separation, exactly-once execution, independent postcondition verification, explicit signer trust, and immutable signed receipts. Do not add unsupported actions or product surfaces without adoption evidence. Update current status, roadmap, or the decision log when work materially changes them.

Historical research is documentation, never runtime configuration or application state. Never silently rewrite historical evidence.
