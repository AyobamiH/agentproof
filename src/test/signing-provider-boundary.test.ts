import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prepareRepositoryPatch, createApprovalRequest, executeApprovedTransaction, getTransactionStatus,
  reconcileRepositoryPatch, signingProviderFromPrivateKeyPem, verifyReceipt, type ExecutionRequestDocument, type SigningProvider } from "../portable.js";
import { createDevelopmentApprovalDecision, createDevelopmentKeyPair } from "../portable-development-authority.js";

const exec = promisify(execFile);
test("injected signer outage preserves verified mutation and reconciliation emits a trusted receipt once", async () => {
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
    const approvalDecision=createDevelopmentApprovalDecision({request,decision:"approved",issuer:"test-development",privateKeyPem:authority.privateKeyPem,developmentMode:true});
    const execution:ExecutionRequestDocument={
      schema:"agentproof.protocol.execution-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",
      correlationId:prepared.correlationId,transactionId:prepared.transactionId,stateDirectory:prepared.stateDirectory,
      idempotencyKey:"provider-once",requiredAuthorityEnvironment:"development",trustedAuthorityFingerprints:[authority.fingerprint],approvalDecision,
    };
    const custody=signingProviderFromPrivateKeyPem("external-provider-fixture",key.privateKeyPem);
    let available=false,signatures=0;
    // Only the provider fixture owns signing material. The caller sees the public interface.
    const provider:SigningProvider={
      keyId:()=>custody.keyId(),publicKeyPem:()=>custody.publicKeyPem(),
      async signCanonical(payload) { if(!available) throw new Error("fixture_provider_unavailable");signatures++;return custody.signCanonical(payload); },
    };
    await assert.rejects(executeApprovedTransaction(execution,{receiptSigner:provider}),/fixture_provider_unavailable/);
    assert.equal(await readFile(path.join(repo,"a.txt"),"utf8"),"after\n");
    const query={stateDirectory:prepared.stateDirectory,transactionId:prepared.transactionId,correlationId:prepared.correlationId};
    assert.equal((await getTransactionStatus(query)).state,"verified");
    available=true;
    const receipt=await reconcileRepositoryPatch({...query,authorityEnvironment:"development"},{receiptSigner:provider});
    assert.ok("payload" in receipt);
    assert.equal(verifyReceipt({document:receipt,trustedSignerFingerprints:[key.fingerprint],requiredAuthorityEnvironment:"development"}).trusted,true);
    assert.equal(verifyReceipt({document:receipt,trustedSignerFingerprints:[key.fingerprint],requiredAuthorityEnvironment:"production"}).trusted,false);
    const retry=await executeApprovedTransaction(execution,{receiptSigner:provider});
    assert.deepEqual(retry,receipt);assert.equal(signatures,1);
    assert.equal(await readFile(path.join(repo,"a.txt"),"utf8"),"after\n");
  } finally { await rm(root,{recursive:true,force:true}); }
});
