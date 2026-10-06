/**
 * Attestation issuance + the tamper-evident hash chain.
 *
 * Every attestation is appended to a hash-chained log: each entry stores
 * `prevHash` (the hash of the entry before it, "GENESIS" for the first) and
 * `hash` = sha256(prevHash || canonical payload). Altering any entry breaks
 * the chain — verified independently via lib/sign.ts `verifyAttestation`.
 */
import { randomUUID } from "node:crypto";
import type { Attestation, AttestationStatus, Subject } from "./types.js";
import { chainHash, signablePayload, signCanonical } from "./sign.js";
import type { AttestationStore } from "./store.js";

export function newAttestationId(): string {
  return `att_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export interface IssueInput {
  type: Attestation["type"];
  status: AttestationStatus;
  reasonCode: string;
  reason: string;
  evidence: Record<string, unknown>;
}

/** Build, sign, hash-chain and persist an attestation. */
export async function issueAttestation(
  store: AttestationStore,
  subject: Subject,
  input: IssueInput,
): Promise<Attestation> {
  const prevHash = await store.latestHash();
  const base: Omit<Attestation, "signature" | "hash"> = {
    id: newAttestationId(),
    type: input.type,
    status: input.status,
    reasonCode: input.reasonCode,
    reason: input.reason,
    evidence: input.evidence,
    signedAt: new Date().toISOString(),
    prevHash,
  };
  const canonical = signablePayload(base);
  const signature = signCanonical(canonical);
  const hash = chainHash(prevHash, canonical);
  const attestation: Attestation = { ...base, signature, hash };
  await store.insert(attestation, subject);
  return attestation;
}

/**
 * Rebuild a mutated attestation with a fresh signature + chain hash.
 *
 * A tamper-evident log must never keep a stale signature: after the C2B
 * callback completes a pending attestation (new status/reason/evidence),
 * the old signature would fail verifyAttestation. The entry keeps its id,
 * signedAt and prevHash; signature and hash are recomputed over the new
 * payload.
 *
 * v0.1 caveat: if a successor entry was already chained onto the old hash
 * in the (short) window between issuance and completion, its prevHash
 * dangles. Completions land seconds after issuance in practice; append-only
 * completions (a new superseding entry instead of a mutation) are the v0.2
 * direction if this ever matters.
 */
export function resignAttestation(
  current: Attestation,
  patch: Pick<Attestation, "status" | "reasonCode" | "reason" | "evidence">,
): Attestation {
  const base: Omit<Attestation, "signature" | "hash"> = {
    id: current.id,
    type: current.type,
    status: patch.status,
    reasonCode: patch.reasonCode,
    reason: patch.reason,
    evidence: patch.evidence,
    signedAt: current.signedAt,
    prevHash: current.prevHash,
  };
  const canonical = signablePayload(base);
  return { ...base, signature: signCanonical(canonical), hash: chainHash(current.prevHash, canonical) };
}
