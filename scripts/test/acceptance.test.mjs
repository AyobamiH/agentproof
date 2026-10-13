import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { RC6, sha256, integrity, verifyReleaseBytes, verifyRegistrySignature, parseOptions } from "../lib/acceptance.mjs";
test("release verification rejects either digest mismatch", () => {
  const bytes=Buffer.from("fixture");const expected={sha256:sha256(bytes),integrity:integrity(bytes)};
  verifyReleaseBytes(bytes,expected);
  assert.throws(()=>verifyReleaseBytes(Buffer.from("altered"),expected),/digest_mismatch/);
  assert.throws(()=>verifyReleaseBytes(bytes,{...expected,integrity:RC6.integrity}),/digest_mismatch/);
});
test("registry signature must bind the exact identity and integrity with a current key", () => {
  const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const data=Buffer.from(RC6.name+"@"+RC6.version+":"+RC6.integrity);
  const sig=sign("sha256",data,pair.privateKey).toString("base64");
  const key={keyid:"test",key:pair.publicKey.export({format:"der",type:"spki"}).toString("base64"),expires:null};
  const m={name:RC6.name,version:RC6.version,dist:{integrity:RC6.integrity,tarball:RC6.tarball,signatures:[{keyid:"test",sig}]}};
  assert.equal(verifyRegistrySignature(m,[key]),"test");
  assert.throws(()=>verifyRegistrySignature({...m,version:"0.1.0-rc.5"},[key]),/identity/);
  assert.throws(()=>verifyRegistrySignature(m,[{...key,expires:"2020-01-01T00:00:00Z"}]),/signature_invalid/);
  assert.throws(()=>verifyRegistrySignature(m,[]),/signature_invalid/);
});
test("network requires explicit consent and candidate cannot claim published release", () => {
  assert.throws(()=>parseOptions(["--output","x"]),/consent/);
  assert.throws(()=>parseOptions(["--output","x","--allow-network","--candidate-tarball","a"]),/candidate/);
  assert.throws(()=>parseOptions(["--output","x","--output","y","--allow-network"]),/duplicate/);
  assert.equal(parseOptions(["--output","x","--allow-network"])["--allow-network"],true);
  assert.equal(parseOptions(["--output","x","--candidate-tarball","a","--source-commit","a".repeat(40)])["--source-commit"],"a".repeat(40));
});
