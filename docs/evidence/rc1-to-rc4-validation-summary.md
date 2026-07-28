# RC1 to RC4 validation summary

This is a public-safe summary; preserved validation kits and raw local records remain historical evidence outside product source.

- **RC1:** external validation found a critical trust-boundary defect in the receipt envelope. Result: rejected for trust; legacy receipts remain untrusted.
- **RC2:** Receipt V2 cryptographically bound verified claims, but runtime validation did not complete and a correlation contract defect remained. Classification: `validation_incomplete_with_known_contract_defect`.
- **RC3:** repaired correlation identity across prepare, approval, execution, compensation, successor receipts, and offline verification. Agent validation passed; public release did not because package licensing/readiness preflight failed.
- **RC4:** Apache-2.0 and prerelease packaging were repaired. AgentProof passed 46/46 tests; disposable Operator integration passed 395/395; deterministic packing, metadata, licence, and secret audits passed. Isolated Developers A–D passed CLI lifecycle, public SDK decisions, a 23-case Receipt V2 adversarial matrix, and generic publication dry-run. RC4 was not published and was superseded by the standalone repository decision.

Historical outcomes constrain current work: never trust RC1 envelopes, preserve the correlation contract, keep production/development authority separate, require pinned signer trust, retain generic release gating, and do not equate automated validation with market adoption.
