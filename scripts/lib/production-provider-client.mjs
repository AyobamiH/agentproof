import { createPublicKey, verify } from "node:crypto";
import { providerPost } from "../../dist/portable-provider-http.js";
import { publicKeyFingerprint } from "../../dist/signer.js";
import { RECEIPT_V2_DOMAIN, payloadDigestV2 } from "../../dist/receipt-v2.js";
import { stableJson } from "../../dist/hash.js";
import { parseJsonStrict } from "../../dist/strict-json.js";

export async function githubToken(audience, signal) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com")) throw new Error("oidc_endpoint_rejected");
  url.searchParams.set("audience", audience);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    redirect: "error", signal });
  if (!response.ok) throw new Error("oidc_unavailable");
  const { value } = await response.json();
  if (typeof value !== "string" || value.length > 16_384) throw new Error("oidc_response_invalid");
  return value;
}

/** Source-only canary client. No local signing material, environment discovery or automatic retries. */
export function remoteReceiptSigner({ endpoint, publicKeyPem, fingerprint, keyId, getToken, approvalDecision, predecessorChain = [] }) {
  const url = new URL(endpoint), key = createPublicKey(publicKeyPem);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      key.asymmetricKeyType !== "ed25519" || publicKeyFingerprint(publicKeyPem) !== fingerprint) throw new Error("signer_configuration_invalid");
  const authority = structuredClone(approvalDecision), predecessors = structuredClone(predecessorChain);
  const post = providerPost(url.href, { getToken, timeoutMs: 30_000 }, "Authorization", "Bearer ");
  return {
    keyId: async () => keyId,
    publicKeyPem: async () => publicKeyPem,
    async signCanonical(input) {
      if (!input.startsWith(RECEIPT_V2_DOMAIN)) throw new Error("receipt_domain_required");
      const raw = input.slice(RECEIPT_V2_DOMAIN.length);
      parseJsonStrict(raw);
      const payload = JSON.parse(raw);
      if (stableJson(payload) !== raw) throw new Error("canonical_receipt_required");
      const proof = await post(JSON.stringify({ payload, approvalDecision: authority, predecessorChain: predecessors }));
      if (proof?.algorithm !== "Ed25519" || proof.keyId !== keyId || proof.publicKeyPem !== publicKeyPem ||
          proof.signerFingerprint !== fingerprint || proof.payloadDigest !== payloadDigestV2(payload) ||
          typeof proof.signatureBase64 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(proof.signatureBase64)) throw new Error("remote_signature_invalid");
      const signature = Buffer.from(proof.signatureBase64, "base64");
      if (signature.toString("base64") !== proof.signatureBase64 || !verify(null, Buffer.from(input), key, signature)) throw new Error("remote_signature_invalid");
      return signature;
    },
  };
}
