import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, createPublicKey, verify } from "node:crypto";
import { digest, stableJson } from "../../../dist/hash.js";
import { publicKeyFingerprint } from "../../../dist/signer.js";
import { verifyReleaseReceiptV2 } from "../../../dist/release-v1-receipt.js";
import { validateClaims, SUBJECT, CANARY_REPOSITORY, WORKFLOW } from "../src/identity.mjs";
import { ReleaseFence, ReleaseReceiptLedger, handle } from "../src/worker.mjs";

const HEAD = "1".repeat(40);
const COMMITS = "a".repeat(40);
const subject = Object.freeze({
  schema: "agentproof.release.subject.v1", provider: "github",
  owner: "AyobamiH", repository: "agentproof-release-canary",
  ownerId: 47716486, repositoryId: 1423718326, releaseId: 81,
  tagName: "v0.0.1-rc.1", tagCommit: COMMITS, packageAssetId: 42,
  packageAssetName: "package.tgz", packageDigest: "sha256:"+"b".repeat(64),
  provenanceAssetId: 43, provenanceDigest: "sha256:"+"c".repeat(64),
  prerelease: true, makeLatest: false,
});
const keyPair = () => {
  const p = generateKeyPairSync("ed25519");
  const privateKeyPem = p.privateKey.export({ format:"pem", type:"pkcs8" }).toString();
  const publicKeyPem = p.publicKey.export({ format:"pem", type:"spki" }).toString();
  return { privateKeyPem, publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem) };
};
const approvalKey = keyPair(), receiptKey = keyPair();
function env(role) {
  const signer = role === "approval" ? approvalKey : receiptKey;
  const vars = { ROLE:role, ENABLED:"true", TRUSTED_SOURCE_SHA:HEAD,
    TARGET_SUBJECT_JSON: JSON.stringify(subject),
    AUDIENCE:"https://agentproof-release-"+(role==="approval"?"approval":"sign")+".woeinvests.workers.dev",
    SIGNING_PRIVATE_KEY_PEM:signer.privateKeyPem,
    SIGNING_PUBLIC_KEY_PEM:signer.publicKeyPem,
    SIGNER_FINGERPRINT:signer.fingerprint,
    AUTHORITY_PUBLIC_KEY_PEM:approvalKey.publicKeyPem,
    AUTHORITY_FINGERPRINT:approvalKey.fingerprint,
    RECEIPT_PUBLIC_KEY_PEM:receiptKey.publicKeyPem,
    RECEIPT_FINGERPRINT:receiptKey.fingerprint };
  const ledger = new Map();
  const fakeStorage = { kv: {
    get(key) { return ledger.get(key); }, put(key, value) { ledger.set(key, value); },
  }, transactionSync(cb) { return cb(); } };
  const inst = role === "approval" ?
    new ReleaseFence({ storage:fakeStorage },vars) :
    new ReleaseReceiptLedger({storage:fakeStorage},vars);
  const namespace = { idFromName(name) { assert.equal(name,"1423718326:81"); return name; },
    get() { return { fetch:r=>inst.fetch(r) }; } };
  if(role==="approval") vars.RELEASE_LEDGER=namespace;
  else vars.RECEIPT_LEDGER=namespace;
  return { vars, ledger };
}
function claims(runId="9002") {
  return {
    repository:CANARY_REPOSITORY, repository_id:"1423718326",
    repository_owner_id:"47716486", actor_id:"47716486", event_name:"workflow_dispatch",
    ref:"refs/heads/main", runner_environment:"github-hosted", workflow_ref:WORKFLOW,
    workflow_sha:HEAD, sha:HEAD, sub:SUBJECT, run_id:runId, run_attempt:"1",
  };
}
function seed(runId="9002") {
  return { stateDirectory:"/tmp/agentproof-release-canary-"+runId,
    transactionId:randomUUID(), nonce:"release-canary:"+runId, idempotencyKey:"release-canary:"+runId,
    subject };
}
function transport(role, path, body, identity=claims()) {
  return new Request("https://agentproof-release-"+(role==="approval"?"approval":"sign")+".woeinvests.workers.dev"+path, {
    method:"POST",headers: {
      "authorization":"Bearer fixture-oidc-assertion",
      ...(role === "approval" ? { "x-github-token":"test-ephemeral-gh-token" } : {}),
      "content-type":"application/json" },body:JSON.stringify(body),
  });
}
function githubFixture(t, options={}) {
  const state = {published:false,publishedAt:null,mutationCount:0,readCount:0};
  t.mock.method(globalThis,"fetch",async (input,init={})=>{
    const url = new URL(String(input));
    assert.equal(url.origin,"https://api.github.com");
    assert.equal(init.redirect,"error");
    assert.match(init.headers["user-agent"], /^agentproof-/);
    if (init.headers.authorization !== undefined)
      assert.equal(init.headers.authorization,"Bearer test-ephemeral-gh-token");
    else assert.equal(init.method,"GET");
    const suffix=url.pathname.replace("/repos/AyobamiH/agentproof-release-canary","");
    let payload;
    if(suffix==="") payload={id:subject.repositoryId,name:subject.repository,
      owner:{login:subject.owner,id:subject.ownerId},private:false};
    else if(suffix==="/git/ref/tags/"+subject.tagName) payload={
      ref:"refs/tags/"+subject.tagName,object:{sha:subject.tagCommit,type:"commit"}};
    else if(suffix==="/releases/"+subject.releaseId && init.method==="GET"){
      state.readCount++;
      if(options.wrongPostcondition && state.published) {
        payload={id:subject.releaseId,tag_name:subject.tagName,draft:false,prerelease:true,
          published_at:state.publishedAt,assets:[]};
      } else payload={id:subject.releaseId,tag_name:subject.tagName,
        draft:!state.published,prerelease:true,
        published_at:state.publishedAt,
        assets:[
          {id:subject.packageAssetId,name:subject.packageAssetName,
            state:"uploaded",digest:subject.packageDigest},
          {id:subject.provenanceAssetId,name:"provenance.json",
            state:"uploaded",digest:subject.provenanceDigest},
        ]};
    } else if(suffix==="/releases/"+subject.releaseId && init.method==="PATCH"){
      state.mutationCount++;
      assert.equal(state.mutationCount,1);
      assert.deepEqual(JSON.parse(init.body),{draft:false,prerelease:true,make_latest:"false"});
      if(options.failBeforeEffect) throw Error("network_failed_pre_effect");
      if(options.rejected) return new Response('{"message":"private provider error detail"}', {
        status:403,headers:{"content-type":"application/json"}});
      state.published=true;state.publishedAt=new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      if(options.lostResponse) throw Error("network_lost_after_effect");
      payload={id:subject.releaseId,tag_name:subject.tagName,
        draft:false,prerelease:true};
    } else throw Error("unanticipated provider request");
    return new Response(JSON.stringify(payload),{status:200,
      headers:{"content-type":"application/json", "x-github-request-id":"fixture-request-1"}});
  });
  return state;
}
async function call(role,env,route,body,run=claims()){
  const res=await handle(transport(role,route,body,run),env.vars,async()=>run);
  const json=await res.json();
  return {status:res.status,json};
}

test("immutable GitHub actor/owner/repo/environment/sha are all exact",()=>{
  const e=env("approval").vars;
  assert.equal(validateClaims(claims(),e).run_id,"9002");
  for(const [k,v] of Object.entries({ repository_id:"wrong",actor_id:"wrong",
    workflow_sha:"2".repeat(40), sha:"2".repeat(40),sub:"repo:legacy",
    event_name:"push",ref:"refs/heads/feature",runner_environment:"self-hosted",
    workflow_ref:"wrong" })){
    assert.throws(()=>validateClaims({...claims(),[k]:v},e),/workload_rejected/);
  }
  assert.throws(()=>validateClaims(claims(),{...e,ENABLED:"false"}),/provider_disabled/);
});

test("one durable global target claim, one GitHub publication and separate signed receipt",async t=>{
  const api=githubFixture(t),a=env("approval"),s=env("signing"),draft=seed();
  const initial=await call("approval",a,"/v1/prepare",{seed:draft});
  assert.equal(initial.status,200);assert.equal(initial.json.state,"reserved");
  const request=initial.json.request;
  assert.equal(request.approval.decision,"approved");
  const different=await call("approval",a,"/v1/prepare",{seed:seed()});
  assert.equal(different.status,409);assert.equal(different.json.error,"release_target_already_claimed");
  const done=await call("approval",a,"/v1/execute",{request});
  assert.equal(done.status,200);assert.equal(done.json.state,"verified");
  assert.equal(api.mutationCount,1);
  assert.deepEqual(done.json.publicationResponse, {
    status: 200, requestId: "fixture-request-1",
    body: JSON.stringify({id:subject.releaseId,tag_name:subject.tagName,draft:false,prerelease:true}),
  });
  assert.deepEqual(a.ledger.get("release").publicationResponse, done.json.publicationResponse);
  assert.match(done.json.completion.after.publishedAt, /\.000Z$/);
  const again=await call("approval",a,"/v1/execute",{request});
  assert.equal(again.json.state,"verified");assert.equal(api.mutationCount,1);
  assert.deepEqual(again.json.publicationResponse,done.json.publicationResponse);
  const receipt=await call("signing",s,"/v1/sign",{request,completion:done.json.completion});
  assert.equal(receipt.status,200);assert.equal(receipt.json.state,"signed");
  const checked=verifyReleaseReceiptV2(receipt.json.receipt,{
    subject,issuer:"agentproof.release-canary.authority.v1",
    authorityFingerprints:[approvalKey.fingerprint],
    signerFingerprint:receiptKey.fingerprint,
    signerKeyId:"agentproof.release-canary.receipts.v1",
  });
  assert.equal(checked.trusted,true);
  assert.equal(checked.verifiedClaims.independentOutcomeVerified,false);
  const second=await call("signing",s,"/v1/sign",{request,completion:done.json.completion});
  assert.deepEqual(second.json.receipt,receipt.json.receipt);
  assert.equal(api.mutationCount,1);
});

test("lost provider response may reconcile but never publishes twice",async t=>{
  const api=githubFixture(t,{lostResponse:true}), a=env("approval");
  const first=await call("approval",a,"/v1/prepare",{seed:seed()});
  const one=await call("approval",a,"/v1/execute",{request:first.json.request});
  assert.equal(one.json.state,"verified");
  assert.equal(one.json.publicationResponse,null);
  const two=await call("approval",a,"/v1/reconcile",{request:first.json.request});
  assert.equal(two.json.state,"verified");assert.equal(api.mutationCount,1);
});

test("failed/ambiguous publication is permanently fenced; reconcile issues zero mutations",async t=>{
  const api=githubFixture(t,{failBeforeEffect:true}),a=env("approval");
  const prepared=await call("approval",a,"/v1/prepare",{seed:seed()});
  const first=await call("approval",a,"/v1/execute",{request:prepared.json.request});
  assert.equal(first.json.state,"attempted");assert.equal(api.mutationCount,1);
  for(let i=0;i<3;i++){
    const next=await call("approval",a,"/v1/execute",{request:prepared.json.request});
    assert.equal(next.json.state,"attempted");assert.equal(api.mutationCount,1);
  }
});

test("receipt signer refuses unverified completion or modified authority",async t=>{
  const api=githubFixture(t), a=env("approval"),s=env("signing");
  const p=await call("approval",a,"/v1/prepare",{seed:seed()});
  const x=await call("approval",a,"/v1/execute",{request:p.json.request});
  assert.equal(x.json.state,"verified");
  const altered={...x.json.completion,subjectDigest:"f".repeat(64)};
  const deny=await call("signing",s,"/v1/sign",{request:p.json.request,completion:altered});
  assert.equal(deny.status,403);assert.equal(api.mutationCount,1);
});

test("rejected publication error bodies are not retained or returned",async t=>{
  const api=githubFixture(t,{rejected:true}),a=env("approval");
  const p=await call("approval",a,"/v1/prepare",{seed:seed()});
  const result=await call("approval",a,"/v1/execute",{request:p.json.request});
  assert.equal(result.json.state,"attempted");assert.equal(result.json.publicationResponse,null);
  assert.equal(a.ledger.get("release").publicationResponse,null);
  assert(!JSON.stringify([...a.ledger]).includes("private provider error detail"));
  const recovered=await call("approval",a,"/v1/reconcile",{request:p.json.request});
  assert.equal(recovered.json.publicationResponse,null);assert.equal(api.mutationCount,1);
});


test("unattempted reservation is signed, durable and never returned after an attempt",async t=>{
  const api=githubFixture(t,{failBeforeEffect:true}), a=env("approval"), draft=seed();
  const first=await call("approval",a,"/v1/prepare",{seed:draft});
  assert.equal(first.status,200);
  const {signatureBase64,...unsigned}=first.json.reservation;
  assert.equal(unsigned.requestDigest,digest(first.json.request));
  assert.equal(unsigned.githubRunId,claims().run_id);
  assert.equal(unsigned.workflowCommit,HEAD);
  assert(verify(null,Buffer.from("agentproof.release-reservation.v1\0"+stableJson(unsigned)),
    createPublicKey(approvalKey.publicKeyPem),Buffer.from(signatureBase64,"base64")));
  assert.equal(api.mutationCount,0);
  const again=await call("approval",a,"/v1/prepare",{seed:draft});
  assert.deepEqual(again.json,first.json);
  assert.equal((await call("approval",a,"/v1/prepare",{seed:seed("9003")},claims("9003"))).status,409);
  await call("approval",a,"/v1/execute",{request:first.json.request});
  const attempted=await call("approval",a,"/v1/prepare",{seed:draft});
  assert.equal(attempted.json.state,"attempted");assert.equal(attempted.json.reservation,null);
  assert.equal(api.mutationCount,1);
});
