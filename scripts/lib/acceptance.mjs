import { createHash, createPublicKey, verify } from "node:crypto";

export const RC6 = Object.freeze({
  name: "@oneclicksystems/agentproof",
  version: "0.1.0-rc.6",
  sourceCommit: "a0ee17a70d05bc3c339c0c15be6bb38b4517771a",
  sha256: "f9dd7eb65f5809c69584624272c0c7dc13a84209c4a2daee338dfee43f5050ca",
  integrity: "sha512-+PoO/Q2su6AreygVjMzmeVQEA/+H2/LXVHqNw+ttVh/n+7m0tl52j3JiEm3tj2fo36sJq20mzEhEsnvub8tRFA==",
  tarball: "https://registry.npmjs.org/@oneclicksystems/agentproof/-/agentproof-0.1.0-rc.6.tgz",
});
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const integrity = bytes => "sha512-" + createHash("sha512").update(bytes).digest("base64");

export function verifyReleaseBytes(bytes, expected = RC6) {
  if (sha256(bytes) !== expected.sha256 || integrity(bytes) !== expected.integrity)
    throw new Error("release_digest_mismatch");
}
export function verifyRegistrySignature(metadata, keys, now = Date.now()) {
  if (metadata.name !== RC6.name || metadata.version !== RC6.version ||
      metadata.dist?.integrity !== RC6.integrity || metadata.dist?.tarball !== RC6.tarball)
    throw new Error("registry_identity_mismatch");
  for (const signature of metadata.dist.signatures ?? []) {
    const key = keys.find(item => item.keyid === signature.keyid);
    if (!key || (key.expires && !(Date.parse(key.expires) > now))) continue;
    try {
      if (verify("sha256", Buffer.from(RC6.name + "@" + RC6.version + ":" + RC6.integrity),
        createPublicKey({ key: Buffer.from(key.key, "base64"), format: "der", type: "spki" }),
        Buffer.from(signature.sig, "base64"))) return key.keyid;
    } catch { /* Try another advertised registry key. */ }
  }
  throw new Error("registry_signature_invalid");
}
export async function publicBytes(url, maxBytes = 10 * 1024 * 1024) {
  const target = new URL(url);
  if (target.origin !== "https://registry.npmjs.org" || target.username || target.password)
    throw new Error("registry_origin_required");
  const response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("registry_response_rejected");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error("registry_response_too_large"); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function parseOptions(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!["--output", "--candidate-tarball", "--source-commit", "--allow-network"].includes(name) ||
        Object.hasOwn(result, name)) throw new Error("invalid_or_duplicate_option");
    if (name === "--allow-network") result[name] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("option_value_required");
      result[name] = args[++i];
    }
  }
  if (!result["--output"]) throw new Error("output_required");
  if (result["--candidate-tarball"]) {
    if (result["--allow-network"] || !/^[a-f0-9]{40}$/.test(result["--source-commit"] ?? ""))
      throw new Error("candidate_requires_source_commit_and_no_network");
  } else if (!result["--allow-network"] || result["--source-commit"]) throw new Error("release_requires_network_consent");
  return result;
}
