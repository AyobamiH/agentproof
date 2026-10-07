# RC5 registry reconciliation

Observed 7 October 2026. This records a read-only reconciliation of existing
publication, followed by an isolated local development test. It does not publish
a package, approve a stage, alter a release tag, or exercise production authority.

## Exact public subject

- Package: `@oneclicksystems/agentproof@0.1.0-rc.5`
- GitHub release: `https://github.com/AyobamiH/agentproof/releases/tag/v0.1.0-rc.5`
- Registry tarball: `https://registry.npmjs.org/@oneclicksystems/agentproof/-/agentproof-0.1.0-rc.5.tgz`
- Registry integrity: `sha512-BC9RJzgn6SVmOcB0jzYMBzGLFkByW11CgthWW5LixEvCFyYJfmHyD/JjW509xHo2VdQir4tjZvIw4TcvQDFI+Q==`
- Registry SHA-1: `9af5e487bfbed75bd0beabdf6a6cac3543b04f94`
- GitHub and registry tarball SHA-256: `a7e085a9202e88db02511309b2ee5f9c62cd4bbb69cb00c4c609b8116eee2a7a`
- Package entries: 81; differing entries: zero
- Registry signature: one package verified by `npm audit signatures`

## Clean consumer outcome

A fresh install from the public registry with lifecycle scripts disabled imported
the public ESM exports successfully. The installed CLI then completed the
package's documented development quickstart against a disposable local Git
repository: prepare, transaction-bound approval, execution, offline receipt
verification against an explicitly trusted fingerprint, exactly-once retry, and
compensation. The original execution and retry receipt bytes were identical.

The fixture uses development authority and disposable keys. No private key,
credential, mutable SQLite state, or machine-specific path is retained here.
This owner-side consumer test does not count as an independent customer
installation, measured adoption, native Windows acceptance, or production
authority/signing proof.

## Version boundary

The prior statement that RC5 had never existed on npm is contradicted by the
registry response and exact artifact comparison. RC5 publication is now evidenced;
RC6 remains a separate package version. The GitHub RC6 release at
`a0ee17a70d05bc3c339c0c15be6bb38b4517771a` passed release workflow
`https://github.com/AyobamiH/agentproof/actions/runs/37572076728`. Its asset SHA-256
is `f9dd7eb65f5809c69584624272c0c7dc13a84209c4a2daee338dfee43f5050ca`.
Those facts do not establish RC6 npm publication or an
AgentProof-to-DoneState-to-OpsTruth runtime integration. The public registry
version list contained RC5 only at this observation.
