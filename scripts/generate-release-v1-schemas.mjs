// Source-only release candidate schemas. No published RC6 contract is replaced.
import { readFile, writeFile } from "node:fs/promises";

const schemaUrl = "https://json-schema.org/draft/2020-12/schema";
const string = { type: "string", minLength: 1 };
const int = { type: "integer", minimum: 1 };
const bool = { type: "boolean" };
const fp = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const hex = { type: "string", pattern: "^[0-9a-f]{64}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{40}$" };
const ts = { type: "string", format: "date-time" };
const uuid = { type: "string", pattern: "^[0-9a-f-]{36}$" };
const signature = { type: "string", pattern: "^[A-Za-z0-9+/]{86}==$" };
function object(properties) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}
const subject = object({
  schema: { const: "agentproof.release.subject.v1" }, provider: { const: "github" },
  owner: { type: "string", pattern: "^[A-Za-z0-9-]{1,39}$" },
  repository: { type: "string", pattern: "^[A-Za-z0-9._-]{1,100}$" },
  ownerId: int, repositoryId: int, releaseId: int,
  tagName: { type: "string", pattern: "^v[0-9]+\\.[0-9]+\\.[0-9]+(-rc\\.[0-9]+)?$" },
  tagCommit: sha, packageAssetId: int,
  packageAssetName: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" },
  packageDigest: fp, provenanceAssetId: int, provenanceDigest: fp,
  prerelease: { const: true }, makeLatest: { const: false },
});
const approval = object({
  schema: { const: "agentproof.release.approval.v1" },
  actionType: { const: "agentproof.release.v1" }, subjectDigest: hex,
  transactionId: uuid, nonce: { type: "string", minLength: 8, maxLength: 128 },
  decision: { enum: ["approved", "denied"] }, environment: { enum: ["production", "development"] },
  issuer: string, decidedAt: ts, expiresAt: ts,
  authorityPublicKeyPem: string, signatureBase64: signature,
});
const observation = object({
  schema: { const: "agentproof.release.observation.v1" },
  ownerId: int, repositoryId: int, releaseId: int, tagName: string, tagCommit: sha,
  packageAssetId: int, packageAssetName: string, packageDigest: fp,
  provenanceAssetId: int, provenanceDigest: fp, assetCount: { const: 2 },
  draft: bool, prerelease: { const: true }, publishedAt: { anyOf: [ts, { type: "null" }] },
});
const receipt = object({
  payload: object({
    schemaId: { const: "agentproof.signed-receipt.v2" }, schemaVersion: { const: "2.0.0" },
    receiptFormatVersion: { const: "v2" }, actionType: { const: "agentproof.release.v1" },
    receiptId: uuid, issuedAt: ts, transactionId: uuid,
    nonce: { type: "string", minLength: 8, maxLength: 128 },
    idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
    subject: { "$ref": "#/$defs/subject" }, subjectDigest: hex,
    approval: { "$ref": "#/$defs/approval" }, approvalDigest: hex, intentDigest: hex,
    effect: { const: "publish_exact_existing_draft_prerelease" },
    attemptedAt: ts, verifiedAt: ts, before: { "$ref": "#/$defs/observation" },
    after: { "$ref": "#/$defs/observation" }, verificationState: { const: "verified_provider_readback" },
    independentOutcomeVerified: { const: false }, compensationState: { const: "not_supported" },
    signerRole: { const: "independent_receipt_signer" }, signingPolicyId: string,
    predecessorPayloadDigest: { type: "null" },
  }),
  proof: object({
    algorithm: { const: "Ed25519" }, keyId: string, publicKeyPem: string,
    signerFingerprint: fp, payloadDigest: hex, signatureBase64: signature,
  }),
});
receipt.$defs = { subject, approval, observation };
const entries = [
  ["release-v1-subject", subject],
  ["release-v1-approval", approval],
  ["release-v2-receipt", receipt],
];
const check = process.argv.includes("--check");
for (const [name, shape] of entries) {
  const document = { "$schema": schemaUrl, "$id": "https://agentproof.dev/schemas/candidate/" + name + ".schema.json", ...shape };
  const expected = JSON.stringify(document, null, 2) + "\n";
  const file = new URL("../schemas/" + name + ".schema.json", import.meta.url);
  if (check) {
    const actual = await readFile(file, "utf8");
    if (expected !== actual) throw new Error(name + ": generated schema drift");
  } else await writeFile(file, expected);
}
console.log("release.v1 candidate schema generation " + (check ? "verified" : "complete"));
