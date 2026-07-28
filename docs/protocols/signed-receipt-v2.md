# Signed receipt V2 migration

AgentProof 0.1.0-rc1 receipts are rejected for trust decisions. Their inner
Ed25519 signature may remain mathematically valid, but the RC1 transport
envelope did not bind the authority environment, correlation ID, or transaction
ID. The V2 verifier returns `legacy_unbound_receipt`, never `trusted: true`.

Do not rewrite, upgrade, or re-sign an RC1 receipt in place. Preserve it as
historical untrusted evidence. Re-run the underlying action through a V2-aware
prepare, approval, execution and verification lifecycle when a trusted V2
receipt is required.

V2 signs exactly `UTF-8("agentproof.signed-receipt.v2\\0" + canonicalJson(payload))`.
Canonical JSON recursively sorts object keys by Unicode code-unit order,
preserves array order and JSON string code points, normalizes negative zero to
zero, preserves `null`, and rejects non-finite numbers, `undefined`, functions,
symbols, bigint values, non-plain objects and cycles. CLI JSON parsing rejects
duplicate object keys.

`proof.payloadDigest` is SHA-256 of those exact signature-input bytes and is
recomputed before signature verification. Verified output identifiers are
derived only from the signed payload. Compensation creates an append-only V2
successor whose signed `predecessorPayloadDigest` authenticates the prior
receipt; predecessors are never mutated.

Migration `003_agentproof_signed_receipt_v2.sql` is prepared for deployment
review. It is not applied automatically to a live Operator database.
