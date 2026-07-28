import { readFile } from "node:fs/promises";
import { verifySignedReceiptOffline, verifySignedReceiptWithTrust } from "./signer.js";
import type { SignedEvidenceReceipt } from "./types.js";

const args = process.argv.slice(2);
const receiptPath = args[0];
const trustIndex = args.indexOf("--trust-fingerprint");
const trustedFingerprint = trustIndex >= 0 ? args[trustIndex + 1] : undefined;
if (!receiptPath || (trustIndex >= 0 && !trustedFingerprint)) {
  process.stderr.write("usage: node dist/verify-receipt.js <signed-receipt.json> [--trust-fingerprint sha256:...]\n");
  process.exitCode = 2;
} else {
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as SignedEvidenceReceipt;
    const result = trustedFingerprint
      ? verifySignedReceiptWithTrust(receipt, { trustedPublicKeyFingerprints: [trustedFingerprint] })
      : { cryptographicallyValid: verifySignedReceiptOffline(receipt), trusted: false,
          publicKeyFingerprint: null, reason: "trust_policy_not_provided" };
    process.stdout.write(JSON.stringify({ ...result, transactionId: receipt.transactionId,
      keyId: receipt.signature?.keyId ?? null }) + "\n");
    if (!result.cryptographicallyValid || (trustedFingerprint && !result.trusted)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("receipt verification failed: " + (error as Error).message + "\n");
    process.exitCode = 2;
  }
}
