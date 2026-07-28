import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { stableJson } from "./hash.js";
import type { EvidenceReceipt, SignedEvidenceReceipt } from "./types.js";
import type { SignedRepositoryPatchReceipt } from "./repository-patch-types.js";

export interface SigningProvider {
  keyId(): Promise<string>;
  publicKeyPem(): Promise<string>;
  signCanonical(payload: string): Promise<Buffer>;
}

export class Ed25519SigningProvider implements SigningProvider {
  constructor(
    private readonly id: string,
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject,
  ) {}

  static generateForTest(id = "agentproof-test-key"): Ed25519SigningProvider {
    const pair = generateKeyPairSync("ed25519");
    return new Ed25519SigningProvider(id, pair.privateKey, pair.publicKey);
  }

  async keyId(): Promise<string> {
    return this.id;
  }

  async publicKeyPem(): Promise<string> {
    return this.publicKey.export({ type: "spki", format: "pem" }).toString();
  }

  async signCanonical(payload: string): Promise<Buffer> {
    return cryptoSign(null, Buffer.from(payload, "utf8"), this.privateKey);
  }
}

export function canonicalReceiptPayload(receipt: EvidenceReceipt): string {
  return stableJson(receipt);
}

export async function signReceipt(
  receipt: EvidenceReceipt,
  provider: SigningProvider,
): Promise<SignedEvidenceReceipt> {
  const canonical = canonicalReceiptPayload(receipt);
  return {
    ...receipt,
    signature: {
      algorithm: "Ed25519",
      keyId: await provider.keyId(),
      publicKeyPem: await provider.publicKeyPem(),
      signatureBase64: (await provider.signCanonical(canonical)).toString("base64"),
    },
  };
}

export function verifySignedReceiptOffline(receipt: SignedEvidenceReceipt): boolean {
  try {
    const { signature, ...unsigned } = receipt;
    if (signature.algorithm !== "Ed25519") return false;
    return cryptoVerify(
      null,
      Buffer.from(canonicalReceiptPayload(unsigned), "utf8"),
      createPublicKey(signature.publicKeyPem),
      Buffer.from(signature.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export interface ReceiptTrustPolicy {
  trustedPublicKeyFingerprints: string[];
}

export interface TrustedReceiptVerification {
  cryptographicallyValid: boolean;
  trusted: boolean;
  publicKeyFingerprint: string | null;
  reason: "trusted" | "valid_untrusted_signer" | "invalid_signature";
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return "sha256:" + createHash("sha256").update(der).digest("hex");
}

export function verifySignedReceiptWithTrust(
  receipt: SignedEvidenceReceipt,
  policy: ReceiptTrustPolicy,
): TrustedReceiptVerification {
  const cryptographicallyValid = verifySignedReceiptOffline(receipt);
  if (!cryptographicallyValid) {
    return { cryptographicallyValid: false, trusted: false, publicKeyFingerprint: null, reason: "invalid_signature" };
  }
  const fingerprint = publicKeyFingerprint(receipt.signature.publicKeyPem);
  const trusted = policy.trustedPublicKeyFingerprints.includes(fingerprint);
  return {
    cryptographicallyValid: true,
    trusted,
    publicKeyFingerprint: fingerprint,
    reason: trusted ? "trusted" : "valid_untrusted_signer",
  };
}

export function verifyRepositoryPatchReceiptWithTrust(
  receipt: SignedRepositoryPatchReceipt,
  policy: ReceiptTrustPolicy,
): TrustedReceiptVerification {
  try {
    const { signature, ...unsigned } = receipt;
    const cryptographicallyValid = signature.algorithm === "Ed25519" && cryptoVerify(
      null,
      Buffer.from(stableJson(unsigned), "utf8"),
      createPublicKey(signature.publicKeyPem),
      Buffer.from(signature.signatureBase64, "base64"),
    );
    if (!cryptographicallyValid) {
      return { cryptographicallyValid: false, trusted: false, publicKeyFingerprint: null, reason: "invalid_signature" };
    }
    const fingerprint = publicKeyFingerprint(signature.publicKeyPem);
    if (signature.signerFingerprint !== fingerprint) {
      return { cryptographicallyValid: false, trusted: false, publicKeyFingerprint: fingerprint, reason: "invalid_signature" };
    }
    const trusted = policy.trustedPublicKeyFingerprints.includes(fingerprint);
    return {
      cryptographicallyValid: true, trusted, publicKeyFingerprint: fingerprint,
      reason: trusted ? "trusted" : "valid_untrusted_signer",
    };
  } catch {
    return { cryptographicallyValid: false, trusted: false, publicKeyFingerprint: null, reason: "invalid_signature" };
  }
}
