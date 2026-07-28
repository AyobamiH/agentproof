import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  compensateRepositoryPatch, compensateRepositoryPatchWithReceipt, createApprovalRequest, executeApprovedTransaction,
  getTransactionStatus, prepareRepositoryPatch, reconcileRepositoryPatch, signingProviderFromPrivateKeyPem, verifyReceipt,
} from "../portable-sdk.js";
import { RepositoryPatchAgentProof } from "../repository-patch-service.js";
import { createDevelopmentApprovalDecision, createDevelopmentKeyPair } from "../portable-sdk.js";
import { payloadDigestV2, signReceiptV2, verifyReceiptV2, type SignedReceiptV2 } from "../receipt-v2.js";
import { digest } from "../hash.js";
import { parseJsonStrict } from "../strict-json.js";
import type { ExecutionRequestDocument, RepositoryPatchRequestDocument } from "../portable-protocol.js";

const exec = promisify(execFile);
async function issued() {
  const root=await mkdtemp(path.join(tmpdir(),"agentproof-v2-")), repo=path.join(root,"repo"), state=path.join(root,"state");
  await exec("git",["init","-b","main",repo]); await exec("git",["-C",repo,"config","user.email","v2@example.invalid"]); await exec("git",["-C",repo,"config","user.name","V2 Test"]);
  await writeFile(path.join(repo,"a.txt"),"before\n"); await exec("git",["-C",repo,"add","."]); await exec("git",["-C",repo,"commit","-m","base"]);
  const request:RepositoryPatchRequestDocument={schema:"agentproof.protocol.repository-patch-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",correlationId:"v2-correlation",stateDirectory:state,action:{type:"agentproof.repository_patch.v1",repositoryRoot:repo,operations:[{kind:"write",path:"a.txt",contentBase64:Buffer.from("after\n").toString("base64")}]},intent:{summary:"V2 test",requestedBy:"test",acceptanceCriteria:["verified"]},policy:{allowedRepositoryRoot:repo,allowedTrackedPaths:["a.txt"],allowedNewPaths:[],maxPatchBytes:1024,maxFiles:1}};
  const prepared=await prepareRepositoryPatch(request), approvalRequest=await createApprovalRequest(prepared,{expiresAt:new Date(Date.now()+60_000).toISOString(),nonce:`nonce-${crypto.randomUUID()}`});
  const authority=createDevelopmentKeyPair(), receiptKey=createDevelopmentKeyPair();
  const decision=createDevelopmentApprovalDecision({request:approvalRequest,decision:"approved",issuer:"v2-development-authority",privateKeyPem:authority.privateKeyPem,developmentMode:true});
  const execution:ExecutionRequestDocument={schema:"agentproof.protocol.execution-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",correlationId:prepared.correlationId,transactionId:prepared.transactionId,stateDirectory:state,idempotencyKey:"v2-idempotency",requiredAuthorityEnvironment:"development",trustedAuthorityFingerprints:[authority.fingerprint],approvalDecision:decision};
  const signer=signingProviderFromPrivateKeyPem("v2-test-receipt-policy",receiptKey.privateKeyPem);
  const receipt=await executeApprovedTransaction(execution,{receiptSigner:signer});
  return {root,repo,state,prepared,approvalRequest,authority,receiptKey,signer,receipt,execution};
}
const clone=<T>(value:T):T=>structuredClone(value);
function setPath(value:Record<string,unknown>,path:string[],replacement:unknown):void { let at=value; for(const key of path.slice(0,-1)) at=at[key] as Record<string,unknown>; at[path.at(-1)!]=replacement; }

test("V2 payload digest, signature, trust, policy, key ordering and legacy rejection",async()=>{
  const x=await issued();
  const trusted=verifyReceipt({document:x.receipt,trustedSignerFingerprints:[x.receiptKey.fingerprint],requiredAuthorityEnvironment:"development",requiredPolicyVersion:"agentproof.repository-patch.v1"});
  assert.equal(trusted.trusted,true); assert.equal(trusted.verifiedClaims?.transactionId,x.prepared.transactionId); assert.equal(trusted.verifiedClaims?.payloadDigest,payloadDigestV2(x.receipt.payload));
  assert.equal(verifyReceipt({document:x.receipt,trustedSignerFingerprints:[]}).reason,"valid_untrusted_signer");
  assert.equal(verifyReceipt({document:x.receipt,trustedSignerFingerprints:[x.receiptKey.fingerprint],requiredAuthorityEnvironment:"production"}).reason,"policy_mismatch");
  const reordered=JSON.parse(JSON.stringify({proof:x.receipt.proof,payload:x.receipt.payload})); assert.equal(verifyReceipt({document:reordered,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).trusted,true);
  const legacy={schema:"agentproof.protocol.signed-receipt",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",correlationId:"attacker",transactionId:"attacker",authorityEnvironment:"production",receipt:{}};
  assert.equal(verifyReceipt({document:legacy,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).reason,"legacy_unbound_receipt");
});

test("field-by-field V2 tamper matrix fails closed",async()=>{
  const x=await issued();
  const payloadPaths=[
    ["transactionId"],["correlationId"],["authorityEnvironment"],["actionType"],["schemaVersion"],["receiptId"],
    ["approvalBinding","originalTaskId"],["approvalBinding","approvalTaskId"],["approvalBinding","approvalDecisionId"],
    ["approvalBinding","approvedFromTaskId"],["approvalBinding","issuer"],["approvalBinding","expiresAt"],["approvalBinding","nonce"],
    ["policyVersion"],["repositoryRootDigest"],["repositoryIdentity","baseCommit"],["evidence","affectedPaths"],
    ["actionDigest"],["preparedActionDigest"],["beforeStateDigest"],["proposedStateDigest"],["observedStateDigest"],
    ["executionState"],["verificationState"],["compensationState"],["predecessorPayloadDigest"],
  ];
  for(const field of payloadPaths){ const altered=clone(x.receipt) as unknown as Record<string,unknown>; setPath(altered,["payload",...field],field.at(-1)==="affectedPaths"?["other.txt"]:"attacker"); const result=verifyReceipt({document:altered,trustedSignerFingerprints:[x.receiptKey.fingerprint]}); assert.equal(result.trusted,false,field.join(".")); assert.equal(result.verifiedClaims,null,field.join(".")); }
  for(const [field,value] of [["payloadDigest","0".repeat(64)],["algorithm","RSA"],["publicKeyPem",createDevelopmentKeyPair().publicKeyPem],["signatureBase64","AA=="]]){ const altered=clone(x.receipt) as unknown as Record<string,unknown>; setPath(altered,["proof",field],value); assert.equal(verifyReceipt({document:altered,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).trusted,false,field); }
  const missing=clone(x.receipt) as unknown as {payload:Record<string,unknown>}; delete missing.payload.transactionId; assert.equal(verifyReceipt({document:missing,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).reason,"invalid_structure");
  const unknown=clone(x.receipt) as unknown as {payload:Record<string,unknown>}; unknown.payload.attacker="x"; assert.equal(verifyReceipt({document:unknown,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).reason,"invalid_structure");
  const other=await issued(), mixed={payload:x.receipt.payload,proof:other.receipt.proof}; assert.equal(verifyReceipt({document:mixed,trustedSignerFingerprints:[other.receiptKey.fingerprint]}).trusted,false);
});

test("signed but internally inconsistent approval binding is not trusted",async()=>{
  const x=await issued(), payload=clone(x.receipt.payload); payload.approvalBinding.nonce="signed-but-inconsistent";
  const malicious=await signReceiptV2(payload,x.signer); const result=verifyReceiptV2({document:malicious,trustedSignerFingerprints:[x.receiptKey.fingerprint]});
  assert.equal(result.cryptographicallyValid,true); assert.equal(result.trusted,false); assert.equal(result.reason,"approval_binding_inconsistent");
});

test("approval request binding is reconstructed before execution",async()=>{
  const x=await issued();
  const duplicate=await executeApprovedTransaction(x.execution,{receiptSigner:x.signer}); assert.equal(duplicate.proof.payloadDigest,x.receipt.proof.payloadDigest);
  const root=await issued(); const altered=clone(root.execution); altered.approvalDecision.approvalRequest.binding={...altered.approvalDecision.approvalRequest.binding,nonce:"substitution"};
  await assert.rejects(executeApprovedTransaction(altered,{receiptSigner:root.signer}),/Approval does not match/);
});

test("compensation creates an authenticated append-only successor chain",async()=>{
  const x=await issued(); const predecessor=JSON.stringify(x.receipt);
  const successor=await compensateRepositoryPatchWithReceipt({stateDirectory:x.state,transactionId:x.prepared.transactionId,correlationId:"v2-correlation",authorityEnvironment:"development"},{receiptSigner:x.signer,trustedSignerFingerprints:[x.receiptKey.fingerprint]});
  assert.equal(JSON.stringify(x.receipt),predecessor); assert.equal(successor.payload.compensationState,"compensated"); assert.equal(successor.payload.predecessorPayloadDigest,x.receipt.proof.payloadDigest);
  assert.equal(verifyReceipt({document:successor,trustedSignerFingerprints:[x.receiptKey.fingerprint],predecessorChain:[x.receipt]}).trusted,true);
  assert.equal(verifyReceipt({document:successor,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).reason,"broken_predecessor_chain");
  assert.equal(await readFile(path.join(x.repo,"a.txt"),"utf8"),"before\n"); assert.equal((await exec("git",["-C",x.repo,"status","--porcelain"])).stdout,"");
});

test("strict JSON rejects duplicate keys and canonicalizer preserves meaningful array order",async()=>{
  assert.throws(()=>parseJsonStrict('{"payload":1,"payload":2}'),/duplicate_key/);
  const x=await issued(), altered=clone(x.receipt); altered.payload.evidence.affectedPaths=[...altered.payload.evidence.affectedPaths].reverse().concat("other");
  assert.equal(verifyReceipt({document:altered,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).trusted,false);
});

test("correlation identity is durable, immutable and distinct across lifecycle results",async()=>{
  const x=await issued();
  assert.equal(x.prepared.correlationId,"v2-correlation");
  assert.notEqual(x.prepared.transactionId,x.prepared.correlationId);
  assert.equal(x.receipt.payload.correlationId,x.prepared.correlationId);
  assert.equal(verifyReceipt({document:{transportCorrelationId:x.prepared.transactionId,receipt:x.receipt},trustedSignerFingerprints:[x.receiptKey.fingerprint]}).verifiedClaims,null);
  assert.equal(verifyReceipt({document:x.receipt,trustedSignerFingerprints:[x.receiptKey.fingerprint]}).verifiedClaims?.correlationId,x.prepared.correlationId);
  const status=await getTransactionStatus({stateDirectory:x.state,transactionId:x.prepared.transactionId,correlationId:x.prepared.correlationId});
  assert.equal(status.correlationId,x.prepared.correlationId);
  const retry=await executeApprovedTransaction(x.execution,{receiptSigner:x.signer});
  assert.equal(retry.payload.correlationId,x.prepared.correlationId);
  const successor=await compensateRepositoryPatchWithReceipt({stateDirectory:x.state,transactionId:x.prepared.transactionId,correlationId:x.prepared.correlationId,authorityEnvironment:"development"},{receiptSigner:x.signer,trustedSignerFingerprints:[x.receiptKey.fingerprint]});
  assert.equal(successor.payload.correlationId,x.prepared.correlationId);
  assert.notEqual(successor.payload.receiptId,x.receipt.payload.receiptId);
  assert.equal(verifyReceipt({document:successor,trustedSignerFingerprints:[x.receiptKey.fingerprint],predecessorChain:[x.receipt]}).verifiedClaims?.correlationId,x.prepared.correlationId);
});

test("missing or mismatched durable, requested and predecessor correlations fail closed",async()=>{
  const x=await issued();
  await assert.rejects(getTransactionStatus({stateDirectory:x.state,transactionId:x.prepared.transactionId,correlationId:x.prepared.transactionId}),/correlation/);
  await assert.rejects(compensateRepositoryPatch({stateDirectory:x.state,transactionId:x.prepared.transactionId,correlationId:x.prepared.transactionId}),/correlation/);
  const service=new RepositoryPatchAgentProof({databasePath:path.join(x.state,"agentproof-portable.sqlite")});
  const stored=await service.store.get(x.prepared.transactionId); stored.correlationId=null; await service.store.save(stored);
  await assert.rejects(getTransactionStatus({stateDirectory:x.state,transactionId:x.prepared.transactionId,correlationId:x.prepared.correlationId}),/correlation/);
  const y=await issued();
  const fakePayload=clone(y.receipt.payload); fakePayload.correlationId="different-signed-correlation"; fakePayload.approvalBinding.correlationId="different-signed-correlation"; fakePayload.approvalBindingDigest=digest(fakePayload.approvalBinding);
  const fakePredecessor=await signReceiptV2(fakePayload,y.signer);
  const successorPayload={...y.receipt.payload,receiptId:crypto.randomUUID(),predecessorPayloadDigest:fakePredecessor.proof.payloadDigest};
  const successor=await signReceiptV2(successorPayload,y.signer);
  assert.equal(verifyReceipt({document:successor,trustedSignerFingerprints:[y.receiptKey.fingerprint],predecessorChain:[fakePredecessor]}).reason,"broken_predecessor_chain");
});

test("unsigned compensation cannot mutate after a signed receipt", async () => {
  const x = await issued();
  await assert.rejects(
    compensateRepositoryPatch({ stateDirectory: x.state, transactionId: x.prepared.transactionId, correlationId: x.prepared.correlationId }),
    (error: unknown) => (error as { code?: string }).code === "signed_successor_required",
  );
  assert.equal(await readFile(path.join(x.repo, "a.txt"), "utf8"), "after\n");
});

test("public reconciliation is correlation-bound and idempotently returns the durable receipt", async () => {
  const x = await issued();
  await assert.rejects(
    reconcileRepositoryPatch({ stateDirectory: x.state, transactionId: x.prepared.transactionId, correlationId: "wrong", authorityEnvironment: "development" }, { receiptSigner: x.signer }),
    (error: unknown) => (error as { code?: string }).code === "correlation_mismatch",
  );
  await assert.rejects(
    reconcileRepositoryPatch({ stateDirectory: x.state, transactionId: x.prepared.transactionId, correlationId: x.prepared.correlationId, authorityEnvironment: "production" }, { receiptSigner: x.signer }),
    (error: unknown) => (error as { code?: string }).code === "authority_environment_mismatch",
  );
  const reconciled = await reconcileRepositoryPatch({ stateDirectory: x.state, transactionId: x.prepared.transactionId, correlationId: x.prepared.correlationId, authorityEnvironment: "development" }, { receiptSigner: x.signer });
  assert.ok("payload" in reconciled);
  assert.equal(reconciled.proof.payloadDigest, x.receipt.proof.payloadDigest);
});
