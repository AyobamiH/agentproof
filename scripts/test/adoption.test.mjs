import test from "node:test";
import assert from "node:assert/strict";
import { summariseRecords, validateRecord } from "../lib/adoption.mjs";
import { RC6 } from "../lib/acceptance.mjs";
const fixture = (n = 1) => ({
  schemaVersion:1, recordId:"record-"+n, participantId:"participant-"+n, evidenceKind:"independent_agent", unfamiliarWithAgentProof:true,
  artifact:{name:RC6.name,version:RC6.version,sourceCommit:RC6.sourceCommit,sha256:RC6.sha256,integrity:RC6.integrity},
  environment:{platform:"linux",node:"v24.18.0",agent:"test fixture"},
  startedAt:"2026-10-13T10:00:00Z",completedAt:"2026-10-13T10:10:00Z",firstTrustedReceiptAt:"2026-10-13T10:02:00Z",
  commandsAttempted:["fixture"],firstBlocker:null,assistanceRequired:[],confusingTerms:[],
  trustRoles:{proposer:true,approvalAuthority:true,executor:true,receiptSigner:true,offlineVerifier:true},
  outcomes:{installation:"PASS",lifecycle:"PASS",independentReceiptVerification:"PASS",exactlyOnce:"PASS",compensation:"PASS",criticalAmbiguity:false},
  intentToIntegrate:"not_asked",nextProtectedAction:null,paymentPreference:null,adoptionChangingRepair:null,
  rawEvidence:[{reference:"fixture-only",sha256:n.toString(16).padStart(64,"0")}],
});
test("engineering runs never count as independent adoption", () => {
  const r=fixture();r.evidenceKind="maintainer_engineering";
  const s=summariseRecords([r]);assert.equal(s.engineeringRuns,1);assert.equal(s.candidateIndependentInstallations,0);
});
test("ten distinct observations still require independence review", () => {
  const s=summariseRecords(Array.from({length:10},(_,i)=>fixture(i+1)));
  assert.equal(s.candidateIndependentInstallations,10);assert.equal(s.gate,"INDEPENDENCE_REVIEW_REQUIRED");
  assert.equal(s.independenceVerified,false);assert.equal(s.productionAuthorityProven,false);
});
test("repeated participants count once and reused evidence cannot impersonate participants", () => {
  const a=fixture(),b=fixture(2);b.participantId=a.participantId;
  assert.equal(summariseRecords([a,b]).candidateIndependentInstallations,1);
  b.participantId="someone-else";b.rawEvidence=a.rawEvidence;
  assert.throws(()=>summariseRecords([a,b]),/shared_evidence/);
  assert.throws(()=>summariseRecords([a,a]),/duplicate_record/);
});
test("missing comprehension, failures and unknown critical ambiguity do not qualify", () => {
  for (const change of [r=>r.trustRoles.receiptSigner=null,r=>r.outcomes.exactlyOnce="FAIL",r=>r.outcomes.criticalAmbiguity=null,r=>r.unfamiliarWithAgentProof=false]) {
    const r=fixture();change(r);assert.equal(summariseRecords([r]).candidateIndependentInstallations,0);
  }
});
test("invalid time, incomplete records and false receipt timing are rejected", () => {
  const r=fixture();r.firstTrustedReceiptAt="2026-10-13T09:00:00Z";assert.throws(()=>validateRecord(r),/times/);
  r.firstTrustedReceiptAt=null;assert.throws(()=>validateRecord(r),/mismatch/);
  const incomplete=fixture();delete incomplete.trustRoles;assert.throws(()=>validateRecord(incomplete),/invalid_adoption/);
});
test("empty collection remains collecting with no fabricated metrics", () => {
  const s=summariseRecords([]);assert.equal(s.gate,"COLLECTING");assert.equal(s.medianTimeToFirstReceiptMs,null);
});
