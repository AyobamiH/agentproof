# Hosted production canary — immutable GitHub identity refusals (17 October 2026)

Two real GitHub-issued canaries reached the external providers before any repository mutation. Both are retained as **failed** engineering evidence, not production-acceptance or independent-adoption credit.

| Workflow | Exact source | Preserved result |
| --- | --- | --- |
| [39007128303](https://github.com/AyobamiH/agentproof/actions/runs/39007128303) | `3d09ce011abfd5f129edf3ca01c6bc0c16283d27` | Seven checks passed. `live_production_approval` stopped with `provider_unavailable`; report SHA-256 `38376a0658451b4f05c9c0003988045e7200aa20797570d98e30171891007011`. |
| [39007674293](https://github.com/AyobamiH/agentproof/actions/runs/39007674293) | `6be99716ab15fbdff912ecea757a6b39851dd7e0` | Seven checks passed. The bounded response diagnostic observed `403 workload_rejected` on authenticated requests; report SHA-256 `c126d17dd3b0bdc5424aba5383d37cfc58a9c1d8fb2aed302c732897f78657b8`. |

The authenticated GitHub repository endpoint `GET /repos/AyobamiH/agentproof/actions/oidc/customization/sub` returned `use_default=true`, `use_immutable_subject=true` and immutable prefix `repo:AyobamiH@47716486/agentproof@1317413810`. The deployed service still expected the legacy name-only subject. Correcting the subject to the immutable owner/repository-ID form preserves (rather than widens) issuer, audience, signature, actor, workflow/ref, exact-commit, environment and run identity checks. The provider conformance test must also reject the legacy subject.

Both Workers were redeployed disabled with all-zero trusted-source pins after each failed canary. Encrypted signing-secret bindings remained present and unchanged. No repository mutation, approved decision, signed receipt, DoneState consequence, OpsTruth verification or independent adopter was established by either run. A fresh reviewed canary and recovery/compensation proof remain necessary.
