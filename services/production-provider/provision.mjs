// One-time bootstrap. Private keys exist only in memory and Wrangler's encrypted secret store.
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { publicKeyFingerprint } from "../../dist/signer.js";

if (process.cwd() !== new URL(".", import.meta.url).pathname.replace(/\/$/, "")) throw new Error("run_from_service_directory");
if (existsSync("public-trust.json")) throw new Error("already_provisioned_use_rotation_runbook");
const wrangler = "node_modules/wrangler/bin/wrangler.js";
const run = (args, input) => {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    input, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8", timeout: 120_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  // Do not forward tool diagnostics from the secret-bearing subprocess.
  if (result.status !== 0) throw new Error("provision_step_failed:" + args[0]);
};
const trust = { schema: "agentproof.production-canary-trust.v1", custody: "cloudflare-encrypted-worker-secret" };
const material = {};
for (const role of ["approval", "receipt"]) {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  material[role] = { privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem,
    fingerprint: publicKeyFingerprint(publicKeyPem) };
  trust[role] = { endpoint: `https://agentproof-${role}.woeinvests.workers.dev/v1/${role === "approval" ? "decisions" : "sign"}`,
    publicKeyPem, fingerprint: material[role].fingerprint,
    ...(role === "approval" ? { issuer: "agentproof.production-canary.authority.v1" } : { keyId: "agentproof.production-canary.receipts.v1" }) };
}
for (const role of ["approval", "receipt"]) {
  const configFile = `wrangler.${role}.jsonc`, config = JSON.parse(readFileSync(configFile, "utf8"));
  if (config.vars.ENABLED !== "false" || config.vars.SIGNING_PUBLIC_KEY_PEM !== "UNCONFIGURED") throw new Error("bootstrap_configuration_required");
  config.vars.SIGNING_PUBLIC_KEY_PEM = material[role].publicKeyPem;
  config.vars.SIGNER_FINGERPRINT = material[role].fingerprint;
  if (role === "receipt") {
    config.vars.AUTHORITY_PUBLIC_KEY_PEM = material.approval.publicKeyPem;
    config.vars.AUTHORITY_FINGERPRINT = material.approval.fingerprint;
  }
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  run(["deploy", "--config", configFile]);
  run(["secret", "put", "SIGNING_PRIVATE_KEY_PEM", "--config", configFile], material[role].privateKey);
  material[role].privateKey = null;
  console.log(JSON.stringify({ role, provisioned: true, enabled: false, fingerprint: material[role].fingerprint }));
}
writeFileSync("public-trust.json", JSON.stringify(trust, null, 2) + "\n", { flag: "wx" });
