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

<!-- agent-foundations:begin -->
## Repository-owned skills and knowledge

Read [secure-api-delivery](.agents/skills/secure-api-delivery/SKILL.md) at the start of every development task, including documentation-only work. Record scope, exact revision, authority, affected trust boundaries and planned checks before edits. Mark checks passed, failed, not run or not applicable with reasons; documentation-only work still needs this initial applicability review.

Read [repository knowledge](.agents/knowledge/README.md) and its relevant linked sources. If the skill is absent from your catalog, open the relative file directly. The complete skill and references belong to this repository; no home-directory installation is required. Existing project instructions and specialised skills remain authoritative for their areas. This guidance does not authorise live scans, credentials, publishing or deployment and is not a CI enforcement claim.

Run `python3 .agents/validate_foundations.py` for the lightweight repository-only discovery check (Python 3.9+ standard library). It validates the local skill files and new navigation links, not application security, live runtime health, every pre-existing onboarding link or Markdown fragment.

Update the relevant knowledge and its authoritative source in the same change when architecture, behaviour, commands or boundaries change. Preserve verified lessons and decision rationale, not raw chat transcripts, secrets or unverified live status. Link to authoritative records rather than maintaining competing copies.
<!-- agent-foundations:end -->
