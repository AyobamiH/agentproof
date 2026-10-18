import {createPublicKey,verify} from 'node:crypto';
import {digest,stableJson} from '../../../dist/hash.js';
import {publicKeyFingerprint} from '../../../dist/signer.js';
import {exactKeys,releaseTime} from '../../../dist/release-v1-contract.js';
import {demand} from './identity.mjs';
export function recoveryPolicy(env) {
  if (env.RECOVERY_REQUIRED !== 'true') return null;
  const key=createPublicKey(env.RECOVERY_HANDOFF_PUBLIC_KEY_PEM);
  const pin=publicKeyFingerprint(env.RECOVERY_HANDOFF_PUBLIC_KEY_PEM);
  demand(key.asymmetricKeyType==='ed25519' && pin===env.RECOVERY_HANDOFF_FINGERPRINT &&
    pin!==env.SIGNER_FINGERPRINT && pin!==env.RECEIPT_FINGERPRINT && pin!==env.AUTHORITY_FINGERPRINT &&
    /^[a-f0-9-]{36}$/.test(env.RECOVERY_RUN_ID), 'recovery_policy_invalid',503);
  return {fingerprint:pin,runId:env.RECOVERY_RUN_ID};
}
export function validateRecoveryGrant(grant,record,claims,env,now=Date.now()) {
  const configured=recoveryPolicy(env);
  demand(configured && stableJson(configured)===stableJson(record.recoveryPolicy), 'recovery_policy_changed');
  exactKeys(grant,['schema','runId','transactionId','subjectDigest','githubRunId','githubRunAttempt',
    'workflowCommit','reservationDigest','authorisationAuditDigest','issuedAt','expiresAt',
    'publicKeyPem','signatureBase64'],'recovery_grant_shape');
  demand(grant.schema==='donestate.release-recovery-authorisation.v1' && grant.runId===configured.runId &&
    grant.transactionId===record.seed.transactionId && grant.subjectDigest===digest(record.seed.subject) &&
    grant.githubRunId===claims.run_id && grant.githubRunAttempt===Number(claims.run_attempt) &&
    grant.workflowCommit===env.TRUSTED_SOURCE_SHA && grant.reservationDigest===digest(record.reservation) &&
    /^[a-f0-9]{64}$/.test(grant.authorisationAuditDigest), 'recovery_grant_binding');
  const issued=releaseTime(grant.issuedAt),expires=releaseTime(grant.expiresAt);
  demand(issued<=now+30000 && expires>now && expires>issued && expires-issued<=300000 &&
    expires<=releaseTime(record.approval.expiresAt), 'recovery_grant_expired');
  const key=createPublicKey(grant.publicKeyPem);
  demand(key.asymmetricKeyType==='ed25519' && publicKeyFingerprint(grant.publicKeyPem)===configured.fingerprint,
    'recovery_grant_signer');
  const {signatureBase64,...unsigned}=grant;
  demand(typeof signatureBase64==='string' && /^[A-Za-z0-9+/]{86}==$/.test(signatureBase64) &&
    Buffer.from(signatureBase64,'base64').toString('base64')===signatureBase64 &&
    verify(null,Buffer.from('donestate.release-recovery-authorisation.v1\0'+stableJson(unsigned)),key,
      Buffer.from(signatureBase64,'base64')), 'recovery_grant_signature');
}

// A later authenticated attempt may inspect the original effect, never spend
// the original grant again. Verify that grant at its recorded issuance time.
export function validateRecordedRecoveryGrant(record, claims, env) {
  const configured = recoveryPolicy(env);
  demand(stableJson(configured) === stableJson(record.recoveryPolicy ?? null),
    'recovery_policy_changed');
  if (!configured) return;
  const grant = record.recoveryAuthorisation;
  demand(grant && record.reservation, 'recovery_authorisation_required');
  const producingAttempt = record.reservation.githubRunAttempt;
  demand(record.reservation.githubRunId === claims.run_id &&
    Number.isSafeInteger(producingAttempt) && producingAttempt >= 1 &&
    Number(claims.run_attempt) >= producingAttempt, 'recovery_reader_binding');
  validateRecoveryGrant(grant, record,
    {...claims, run_attempt: String(producingAttempt)}, env, releaseTime(grant.issuedAt));
}
