import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sign } from "node:crypto";
import { stableJson } from "../hash.js";
import { prepareRepositoryPatch, createApprovalRequest, executeApprovedTransaction, getTransactionStatus,
  reconcileRepositoryPatch, signingProviderFromPrivateKeyPem, verifyReceipt, type ExecutionRequestDocument } from "../portable.js";
import { createDevelopmentApprovalDecision, createDevelopmentKeyPair } from "../portable-development-authority.js";

import { createProductionApprovalClient, createVaultTransitSigningProvider } from "../portable-production-providers.js";

const exec = promisify(execFile);
test("external approval and Vault adapters preserve production policy and recover without reexecution (fixtures only)", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "agentproof-provider-"));
  try {
    const repo = path.join(root, "repo");
    const git = (args: string[]) => exec("git", ["-C", repo, ...args]);
    await exec("git", ["init", "-b", "main", repo]);
    await git(["config", "user.email", "provider@example.invalid"]);
    await git(["config", "user.name", "Provider Test"]);
    await writeFile(path.join(repo, "a.txt"), "before\n");
    await git(["add", "a.txt"]); await git(["-c", "commit.gpgsign=false", "commit", "-m", "base"]);
    const prepared = await prepareRepositoryPatch({
      schema:"agentproof.protocol.repository-patch-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",
      correlationId:"provider-outage",stateDirectory:path.join(root,"state"),
      action:{type:"agentproof.repository_patch.v1",repositoryRoot:repo,operations:[{kind:"write",path:"a.txt",contentBase64:Buffer.from("after\n").toString("base64")}]},
      intent:{summary:"Signer outage fixture",requestedBy:"test",acceptanceCriteria:["exact bytes"]},
      policy:{allowedRepositoryRoot:repo,allowedTrackedPaths:["a.txt"],allowedNewPaths:[],maxPatchBytes:1024,maxFiles:1},
    });
    const request=await createApprovalRequest(prepared,{expiresAt:new Date(Date.now()+60_000).toISOString(),nonce:"provider-nonce"});
    const authority=createDevelopmentKeyPair(),key=createDevelopmentKeyPair();
    let available=false,signatures=0;
    const custody=signingProviderFromPrivateKeyPem("external-provider-fixture",key.privateKeyPem);
    // Disposable services and identities prove wire/SDK conformance, never production custody.
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (url === "https://approval.example.invalid/decisions") {
        assert.deepEqual(JSON.parse(init.body as string), request);
        const unsigned = {
          schema: "agentproof.protocol.approval-decision", schemaVersion: "1.0.0",
          actionType: request.actionType, correlationId: request.correlationId, transactionId: request.transactionId,
          requestDigest: request.requestDigest, preparedDigest: request.preparedDigest,
          decision: "approved", authorityEnvironment: "production", issuer: "isolated-fixture-policy",
          decidedAt: new Date().toISOString(), expiresAt: request.expiresAt, nonce: request.nonce,
          authorityPublicKeyPem: authority.publicKeyPem, authorityFingerprint: authority.fingerprint,
          approvalRequest: request,
        };
        return new Response(JSON.stringify({ ...unsigned,
          signatureBase64: sign(null, Buffer.from(stableJson(unsigned)), authority.privateKeyPem).toString("base64") }),
          { headers: { "content-type": "application/json" } });
      }
      assert.equal(url, "https://vault.example.invalid/v1/transit/sign/receipt");
      if (!available) return new Response("unavailable", { status: 503 });
      signatures++;
      const input = Buffer.from(JSON.parse(init.body as string).input, "base64").toString("utf8");
      const signature = await custody.signCanonical(input);
      return new Response(JSON.stringify({ data: { signature: "vault:v1:" + signature.toString("base64") } }),
        { headers: { "content-type": "application/json" } });
    });
    const approvalDecision = await createProductionApprovalClient({
      endpoint: "https://approval.example.invalid/decisions", expectedIssuer: "isolated-fixture-policy",
      trustedAuthorityFingerprints: [authority.fingerprint], getToken: async () => "approval-fixture-token",
    }).requestApproval(request);
    const execution:ExecutionRequestDocument={
      schema:"agentproof.protocol.execution-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",
      correlationId:prepared.correlationId,transactionId:prepared.transactionId,stateDirectory:prepared.stateDirectory,
      idempotencyKey:"provider-once",requiredAuthorityEnvironment:"production",trustedAuthorityFingerprints:[authority.fingerprint],approvalDecision,
    };
    const provider = createVaultTransitSigningProvider({
      address: "https://vault.example.invalid", mountPath: "transit", keyName: "receipt",
      keyVersion: 1, keyId: "external-provider-fixture", publicKeyPem: key.publicKeyPem,
      trustedSignerFingerprint: key.fingerprint, getToken: async () => "fixture-token",
    });
    const developmentDecision=createDevelopmentApprovalDecision({request,decision:"approved",issuer:"test-development",privateKeyPem:authority.privateKeyPem,developmentMode:true});
    await assert.rejects(executeApprovedTransaction({...execution,approvalDecision:developmentDecision},{receiptSigner:provider}),/Approval does not match/);
    assert.equal(await readFile(path.join(repo,"a.txt"),"utf8"),"before\n");
    await assert.rejects(executeApprovedTransaction(execution,{receiptSigner:provider}),/provider_unavailable/);
    assert.equal(await readFile(path.join(repo,"a.txt"),"utf8"),"after\n");
    const query={stateDirectory:prepared.stateDirectory,transactionId:prepared.transactionId,correlationId:prepared.correlationId};
    assert.equal((await getTransactionStatus(query)).state,"verified");
    available=true;
    const receipt=await reconcileRepositoryPatch({...query,authorityEnvironment:"production"},{receiptSigner:provider});
    assert.ok("payload" in receipt);
    assert.equal(verifyReceipt({document:receipt,trustedSignerFingerprints:[key.fingerprint],requiredAuthorityEnvironment:"production"}).trusted,true);
    assert.equal(verifyReceipt({document:receipt,trustedSignerFingerprints:[key.fingerprint],requiredAuthorityEnvironment:"development"}).trusted,false);
    const retry=await executeApprovedTransaction(execution,{receiptSigner:provider});
    assert.deepEqual(retry,receipt);assert.equal(signatures,1);
    assert.equal(await readFile(path.join(repo,"a.txt"),"utf8"),"after\n");
  } finally { await rm(root,{recursive:true,force:true}); }
});
