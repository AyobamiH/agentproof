# Running and recording adoption validation

These are source-maintainer tools. They are not new package runtime commands and
are not included in the already-published RC6 tarball. Run them from a checkout
after `npm ci`.

## Engineering acceptance

Verify the immutable public RC6 distribution and exercise its installed CLI/SDK:

```sh
node scripts/acceptance.mjs --allow-network --output /absolute/new/rc6-acceptance.json
```

The runner checks the pinned source/release identity, SHA-256, SHA-512 integrity
and current npm registry signature. It uses a fresh cache and an empty consumer,
installs the verified tarball offline with lifecycle scripts disabled, then runs
the existing repository-patch lifecycle in a disposable repository. It checks
package exports, schemas, separate development approval, production-policy
rejection, independent offline receipt verification, tamper/untrusted-key
rejection, exactly-once retry, reconciliation and authenticated compensation.

Network access is confined to explicit unauthenticated npm registry reads. It
does not publish, log in, read npm credentials or change user configuration.
Temporary keys, SQLite state, consumer and Git repository are removed on normal
completion or failure. Reports retain digests and check results, not private keys,
raw receipts or machine paths. An interrupted/killed process may require removal
of its `agentproof-acceptance-*` temporary directory.

The report output must be a new file; existing evidence is never overwritten.
A failure exits 1 and reports its failing step. Invalid options exit 2.
Every run has `independentAdoptionCredit: 0`.

For CI or an unpublished source candidate, pack first and provide its source base:

```sh
npm pack --pack-destination /absolute/temporary-directory
node scripts/acceptance.mjs \
  --candidate-tarball /absolute/temporary-directory/oneclicksystems-agentproof-0.1.0-rc.6.tgz \
  --source-commit <exact-40-character-source-sha> \
  --output /absolute/new/candidate-acceptance.json
```

Candidate mode computes digests, performs no registry reads, and explicitly labels
the artifact `unpublished_source_candidate`. The supplied source commit is an
operator assertion; a local dirty checkout is not proof of commit equivalence.
It never claims those bytes are the published RC6 release.

## Independent installation observations

Keep one JSON record per actual attempt, using
[install-record.schema.json](install-record.schema.json). Preserve the underlying
raw evidence separately and include its reference and SHA-256. Use pseudonymous
participant IDs; do not include tokens, private keys or customer source. Review
records before sharing: observations can contain sensitive information.

Record these observations directly rather than inferring answers:

- Exact package name/version, source commit, tarball digest and npm integrity.
- Platform, Node version, agent identity, start/completion and first trusted receipt time.
- Commands attempted, first blocker, assistance and confusing terms.
- Comprehension of proposer, approval authority, executor, signer and offline verifier.
- Installation, lifecycle, receipt verification, retry and compensation outcomes.
- Critical ambiguity, integration intent, requested action, payment preference and one repair.

Use `NOT_OBSERVED`, `null` or `not_asked` where defined instead of inventing an
answer. Set `evidenceKind` to `maintainer_engineering` for automated or maintainer
tests. Independent installations must be actual unfamiliar participants, not ten
copies of one harness execution.

Aggregate only explicitly supplied records:

```sh
node scripts/adoption-report.mjs /absolute/record-a.json /absolute/record-b.json
```

No arguments reports an empty collection. Invalid records, impossible timing,
duplicate record IDs and shared evidence across different participants fail
closed. Repeated attempts by one participant count at most once. Successful
candidate installations require all lifecycle observations and five-role
comprehension with no critical ambiguity. The report still requires an
independence review even at ten; supplied JSON cannot prove participant identity.
It does not fetch evidence references or activate production authority or actions.

## Public intake

Submit an actual sanitised observation through the repository Independent installation observation issue form. The maintainer must preserve the issue URL, numeric GitHub author ID, observation bytes/hash and evidence references, check affiliation and duplication, and validate the record with the aggregation tool. Submission or an unfamiliar username alone does not establish independence. Automated workflow runs and repositories controlled by the maintainer remain engineering evidence. No credentials or private customer source should be submitted.
