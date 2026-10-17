import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as new (options: Record<string, unknown>) => {
  compile(schema: unknown): (value: unknown) => boolean;
};
const addFormats = require("ajv-formats").default as (ajv: unknown) => void;
const exec = promisify(execFile);

test("release-v1 source schemas remain deterministic", async () => {
  await exec(process.execPath, ["scripts/generate-release-v1-schemas.mjs", "--check"]);
});

test("release-v1 subject and approval schema reject foreign targets and unknown fields", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const load = async (name: string) => JSON.parse(
    await readFile(path.resolve("schemas", name + ".schema.json"), "utf8"));
  const validateSubject = ajv.compile(await load("release-v1-subject"));
  const subject = {
    schema: "agentproof.release.subject.v1", provider: "github", owner: "testowner",
    repository: "disposable", ownerId: 1, repositoryId: 2, releaseId: 3,
    tagName: "v1.0.0-rc.1", tagCommit: "a".repeat(40),
    packageAssetId: 10, packageAssetName: "artifact.tgz",
    packageDigest: "sha256:" + "a".repeat(64), provenanceAssetId: 11,
    provenanceDigest: "sha256:" + "b".repeat(64), prerelease: true, makeLatest: false,
  };
  assert.equal(validateSubject(subject), true);
  for (const modified of [
    { ...subject, releaseId: -1 }, { ...subject, makeLatest: true },
    { ...subject, attack: true }, { ...subject, repository: "other/repo" },
    { ...subject, tagCommit: "not-a-commit" },
  ]) assert.equal(validateSubject(modified), false);
  const validateApproval = ajv.compile(await load("release-v1-approval"));
  const approval = { schema: "agentproof.release.approval.v1", actionType: "agentproof.release.v1",
    subjectDigest: "f".repeat(64), transactionId: "12345678-1234-1234-1234-123456789012",
    nonce: "one-disposable-approval", decision: "approved", environment: "production",
    issuer: "test", decidedAt: "2026-10-17T12:00:00.000Z", expiresAt: "2026-10-17T12:05:00.000Z",
    authorityPublicKeyPem: "fixture-pem", signatureBase64: "A".repeat(86) + "==" };
  assert.equal(validateApproval(approval), true);
  for (const modified of [
    { ...approval, environment: "prod" }, { ...approval, extra: true },
    { ...approval, subjectDigest: "g".repeat(64) },
  ]) assert.equal(validateApproval(modified), false);
});

test("separate Release Receipt V2 schema is strict and does not imply independent verification", async () => {
  const schema = JSON.parse(await readFile(path.resolve("schemas/release-v2-receipt.schema.json"), "utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.payload.additionalProperties, false);
  assert.equal(schema.properties.proof.additionalProperties, false);
  assert.equal(validate({ payload: {}, proof: {} }), false);
  assert.equal(validate({ payload: { independentOutcomeVerified: true }, proof: {} }), false);
  assert.equal(validate({ payload: { actionType: "agentproof.repository_patch.v1" }, proof: {} }), false);
  assert.equal(schema.properties.payload.properties.independentOutcomeVerified.const, false);
  assert.equal(schema.properties.payload.properties.compensationState.const, "not_supported");
});
