import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { digest, stableJson } from "./hash.js";
import { publicKeyFingerprint, type SigningProvider } from "./signer.js";
import type { PortableApprovalRequestDocument, PortableApprovalDecisionDocument } from "./portable-protocol.js";
import { httpsEndpoint, MAX_PROVIDER_BYTES, ProductionProviderError, providerPost, requireProvider,
  type ProviderHttpOptions } from "./portable-provider-http.js";

export { ProductionProviderError } from "./portable-provider-http.js";
export type { ProviderErrorCode, ProviderHttpOptions } from "./portable-provider-http.js";

const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const segmentPattern = /^[A-Za-z0-9_-]+$/;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8192;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: Record<string, unknown>, fields: string) =>
  Object.keys(value).sort().join(" ") === fields.split(" ").sort().join(" ");

function ed25519PublicKey(pem: unknown): KeyObject {
  if (!text(pem) || !/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----\s*$/.test(pem)) throw new Error("public_key_required");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("ed25519_required");
  return key;
}

function signatureBytes(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value)) throw new Error("signature_required");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) throw new Error("signature_encoding_invalid");
  return bytes;
}

export interface VaultTransitSigningOptions extends ProviderHttpOptions {
  /** HTTPS origin only. Mount and key are configured separately. */
  address: string;
  mountPath: string;
  keyName: string;
  /** A fixed positive version; automatic selection of the latest key is forbidden. */
  keyVersion: number;
  keyId: string;
  publicKeyPem: string;
  trustedSignerFingerprint: string;
  namespace?: string;
}

/** Explicit Vault Transit Ed25519 integration. Does not create keys, grant access, or activate production. */
export function createVaultTransitSigningProvider(options: VaultTransitSigningOptions): SigningProvider {
  const address = httpsEndpoint(options.address, true);
  const { mountPath, keyName, keyVersion, keyId, namespace, trustedSignerFingerprint } = options;
  requireProvider(text(mountPath) && mountPath.split("/").every(part => segmentPattern.test(part)) &&
    text(keyName) && segmentPattern.test(keyName) && Number.isSafeInteger(keyVersion) && keyVersion > 0 &&
    text(keyId) && fingerprintPattern.test(trustedSignerFingerprint) &&
    (namespace === undefined || (text(namespace) && namespace.split("/").every(part => segmentPattern.test(part)))),
  "provider_configuration_invalid");
  let key: KeyObject, publicKeyPem: string;
  try {
    key = ed25519PublicKey(options.publicKeyPem);
    publicKeyPem = key.export({ type: "spki", format: "pem" }).toString();
    requireProvider(publicKeyFingerprint(publicKeyPem) === trustedSignerFingerprint, "provider_configuration_invalid");
  } catch { throw new ProductionProviderError("provider_configuration_invalid"); }
  const post = providerPost(`${address}/v1/${mountPath}/sign/${keyName}`, options, "X-Vault-Token", "",
    namespace === undefined ? {} : { "X-Vault-Namespace": namespace });
  return Object.freeze({
    async keyId() { return keyId; },
    async publicKeyPem() { return publicKeyPem; },
    async signCanonical(payload: string) {
      requireProvider(typeof payload === "string" && Buffer.byteLength(payload) > 0 &&
        Buffer.byteLength(payload) <= MAX_PROVIDER_BYTES / 2, "provider_input_invalid");
      const result = await post(JSON.stringify({ input: Buffer.from(payload, "utf8").toString("base64"),
        key_version: keyVersion, prehashed: false }));
      try {
        requireProvider(record(result) && record(result.data) && typeof result.data.signature === "string",
          "provider_signature_invalid");
        const prefix = `vault:v${keyVersion}:`;
        requireProvider(result.data.signature.startsWith(prefix), "provider_signature_invalid");
        const signature = signatureBytes(result.data.signature.slice(prefix.length));
        requireProvider(verify(null, Buffer.from(payload, "utf8"), key, signature), "provider_signature_invalid");
        return signature;
      } catch { throw new ProductionProviderError("provider_signature_invalid"); }
    },
  });
}

export interface ProductionApprovalOptions extends ProviderHttpOptions {
  /** HTTPS endpoint accepting an approval request and returning the signed decision directly. */
  endpoint: string;
  expectedIssuer: string;
  trustedAuthorityFingerprints: readonly string[];
}

function utcTime(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized ? timestamp : NaN;
}

function validateRequest(value: unknown): asserts value is PortableApprovalRequestDocument {
  requireProvider(record(value) && exactKeys(value,
    "schema schemaVersion actionType correlationId transactionId stateDirectory preparedDigest expiresAt nonce binding requestDigest"), "provider_input_invalid");
  requireProvider(value.schema === "agentproof.protocol.approval-request" && value.schemaVersion === "1.0.0" &&
    value.actionType === "agentproof.repository_patch.v1" &&
    [value.correlationId, value.transactionId, value.stateDirectory, value.nonce].every(text) &&
    typeof value.preparedDigest === "string" && digestPattern.test(value.preparedDigest) &&
    typeof value.requestDigest === "string" && digestPattern.test(value.requestDigest) &&
    utcTime(value.expiresAt) > Date.now(), "provider_input_invalid");
  const binding = value.binding;
  requireProvider(record(binding) && exactKeys(binding,
    "schemaVersion transactionId intentDigest actionDigest target baseCommit branch beforeManifestDigest proposedManifestDigest patchDigest expectedDiffDigest affectedPaths verificationPlanDigest policyVersion expiresAt nonce"), "provider_input_invalid");
  requireProvider(binding.schemaVersion === "agentproof.repository-patch.approval.v1" &&
    binding.policyVersion === "agentproof.repository-patch.v1" && binding.transactionId === value.transactionId &&
    binding.expiresAt === value.expiresAt && binding.nonce === value.nonce &&
    [binding.target, binding.baseCommit, binding.branch].every(text) &&
    [binding.intentDigest, binding.actionDigest, binding.beforeManifestDigest, binding.proposedManifestDigest,
      binding.patchDigest, binding.expectedDiffDigest, binding.verificationPlanDigest].every(v => typeof v === "string" && digestPattern.test(v)) &&
    Array.isArray(binding.affectedPaths) && binding.affectedPaths.length > 0 && binding.affectedPaths.every(text) &&
    new Set(binding.affectedPaths).size === binding.affectedPaths.length, "provider_input_invalid");
  const { requestDigest, ...unsigned } = value;
  requireProvider(requestDigest === digest(unsigned), "provider_input_invalid");
}

/** Requests a decision; never grants approval locally. Signed denials are returned unchanged. */
export function createProductionApprovalClient(options: ProductionApprovalOptions): {
  requestApproval(request: PortableApprovalRequestDocument): Promise<PortableApprovalDecisionDocument>;
} {
  const endpoint = httpsEndpoint(options.endpoint);
  const issuer = options.expectedIssuer;
  requireProvider(text(issuer) && Array.isArray(options.trustedAuthorityFingerprints) &&
    options.trustedAuthorityFingerprints.length > 0 && options.trustedAuthorityFingerprints.every(fp =>
      typeof fp === "string" && fingerprintPattern.test(fp)), "provider_configuration_invalid");
  const fingerprints = new Set(options.trustedAuthorityFingerprints);
  const post = providerPost(endpoint, options, "Authorization", "Bearer ");
  return Object.freeze({
    async requestApproval(request: PortableApprovalRequestDocument) {
      let body: string, snapshot: PortableApprovalRequestDocument;
      try {
        body = stableJson(request);
        requireProvider(Buffer.byteLength(body) <= MAX_PROVIDER_BYTES, "provider_input_invalid");
        snapshot = JSON.parse(body);
        validateRequest(snapshot);
      } catch { throw new ProductionProviderError("provider_input_invalid"); }
      const decision = await post(body);
      try {
        requireProvider(record(decision) && exactKeys(decision,
          "schema schemaVersion actionType correlationId transactionId requestDigest preparedDigest decision authorityEnvironment issuer decidedAt expiresAt nonce authorityPublicKeyPem authorityFingerprint approvalRequest signatureBase64"), "provider_approval_invalid");
        requireProvider(decision.schema === "agentproof.protocol.approval-decision" && decision.schemaVersion === "1.0.0" &&
          decision.actionType === "agentproof.repository_patch.v1" && decision.authorityEnvironment === "production" &&
          decision.issuer === issuer && (decision.decision === "approved" || decision.decision === "denied") &&
          ["correlationId", "transactionId", "requestDigest", "preparedDigest", "expiresAt", "nonce"].every(field =>
            decision[field] === (snapshot as unknown as Record<string, unknown>)[field]) &&
          stableJson(decision.approvalRequest) === body && utcTime(decision.expiresAt) > Date.now() &&
          Number.isFinite(utcTime(decision.decidedAt)) && utcTime(decision.decidedAt) <= Date.now() &&
          utcTime(decision.decidedAt) < utcTime(decision.expiresAt) &&
          typeof decision.authorityFingerprint === "string" && fingerprints.has(decision.authorityFingerprint),
        "provider_approval_invalid");
        const key = ed25519PublicKey(decision.authorityPublicKeyPem);
        requireProvider(publicKeyFingerprint(decision.authorityPublicKeyPem as string) === decision.authorityFingerprint,
          "provider_approval_invalid");
        const { signatureBase64, ...unsigned } = decision;
        requireProvider(verify(null, Buffer.from(stableJson(unsigned)), key, signatureBytes(signatureBase64)),
          "provider_approval_invalid");
        return decision as unknown as PortableApprovalDecisionDocument;
      } catch { throw new ProductionProviderError("provider_approval_invalid"); }
    },
  });
}
