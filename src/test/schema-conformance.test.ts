import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as new (options: Record<string, unknown>) => { compile(schema: unknown): (value: unknown) => boolean };
const addFormats = require("ajv-formats").default as (ajv: unknown) => void;
import { validateReceiptV2, verifyReceiptV2 } from "../receipt-v2.js";

test("every shipped schema is strict JSON without unconstrained properties",async()=>{
  const names=["repository-patch-request","prepared-repository-patch","approval-request","approval-decision","execution-request","signed-receipt","receipt-verification-result","transaction-status","agent-proof-error"];
  for(const name of names){ const raw=await readFile(path.resolve("schemas",`${name}.schema.json`),"utf8"); const schema=JSON.parse(raw); assert.equal(schema.additionalProperties,false,name); assert.equal(raw.includes('"properties": {}'),false,name); }
});

test("signed-receipt public schema and runtime reject the same structural mutations",async()=>{
  const schema=JSON.parse(await readFile(path.resolve("schemas/signed-receipt.schema.json"),"utf8"));
  const ajv=new Ajv2020({strict:true,allErrors:true}); addFormats(ajv); const validate=ajv.compile(schema);
  const invalid=[null,{}, {payload:{},proof:{}}, {payload:{attacker:true},proof:{}}];
  for(const value of invalid){ assert.equal(validate(value),false); assert.throws(()=>validateReceiptV2(value)); }
});

test("all shipped RC3 fixtures match schema and runtime classifications",async()=>{
  const ajv=new Ajv2020({strict:true,allErrors:true}); addFormats(ajv);
  const load=async(name:string)=>JSON.parse(await readFile(path.resolve("fixtures",name),"utf8"));
  for(const [fixture,schemaName] of [["request.json","repository-patch-request"],["prepared-success.json","prepared-repository-patch"],["approval-request.json","approval-request"],["approval-approved.json","approval-decision"],["approval-denied.json","approval-decision"],["approval-expired.json","approval-decision"]]){
    const schema=JSON.parse(await readFile(path.resolve("schemas",`${schemaName}.schema.json`),"utf8")); delete schema.$id; assert.equal(ajv.compile(schema)(await load(fixture)),true,fixture);
  }
  const receiptSchema=JSON.parse(await readFile(path.resolve("schemas/signed-receipt.schema.json"),"utf8")), validate=ajv.compile(receiptSchema);
  const trusted=await load("receipt-trusted.json"), untrusted=await load("receipt-untrusted.json"), tampered=await load("receipt-tampered.json"), successor=await load("receipt-compensated-successor.json"), legacy=await load("receipt-legacy-rc1.json"), policy=await load("trust-policy.json");
  for(const value of [trusted,untrusted,tampered,successor]) assert.equal(validate(value),true);
  assert.equal(validate(legacy),false);
  assert.equal(verifyReceiptV2({document:trusted,trustedSignerFingerprints:policy.trustedSignerFingerprints}).reason,"trusted");
  assert.equal(verifyReceiptV2({document:untrusted,trustedSignerFingerprints:policy.trustedSignerFingerprints}).reason,"valid_untrusted_signer");
  assert.equal(verifyReceiptV2({document:tampered,trustedSignerFingerprints:policy.trustedSignerFingerprints}).trusted,false);
  assert.equal(verifyReceiptV2({document:legacy,trustedSignerFingerprints:policy.trustedSignerFingerprints}).reason,"legacy_unbound_receipt");
  assert.equal(verifyReceiptV2({document:successor,trustedSignerFingerprints:policy.trustedSignerFingerprints,predecessorChain:[trusted]}).trusted,true);
});
