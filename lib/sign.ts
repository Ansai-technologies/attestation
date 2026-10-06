/**
 * Signature issuance + verification for attestations.
 *
 * Every attestation is Ed25519-signed over a canonical (sorted-key) JSON of
 * the attestation payload. Anyone with the public key can re-verify the
 * signature independently of this service. The same canonical payload is
 * hashed into the tamper-evident chain (see attest.ts).
 */
import { createHash, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import type { Attestation } from "./types.js";

/** Deterministic JSON: recursively sorts object keys. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/** Payload that is signed + hashed: everything except `signature` and `hash`. */
export function signablePayload(att: Omit<Attestation, "signature" | "hash">): string {
  return canonicalize(att);
}

/** sha256(prevHash || canonicalPayload). */
export function chainHash(prevHash: string, canonicalPayload: string): string {
  return createHash("sha256").update(prevHash + canonicalPayload, "utf8").digest("hex");
}

function privateKeyPem(): string {
  const pem = process.env.ED25519_PRIVATE_KEY_PEM;
  if (!pem) throw new Error("ED25519_PRIVATE_KEY_PEM is not configured");
  return pem.replace(/\\n/g, "\n");
}

function publicKeyPem(): string {
  const pem = process.env.ED25519_PUBLIC_KEY_PEM;
  if (!pem) throw new Error("ED25519_PUBLIC_KEY_PEM is not configured");
  return pem.replace(/\\n/g, "\n");
}

export function signCanonical(canonicalPayload: string): string {
  // Ed25519 is PureEdDSA: sign the message directly, no pre-hash.
  return cryptoSign(null, Buffer.from(canonicalPayload, "utf8"), privateKeyPem()).toString("base64");
}

export function verifySignature(canonicalPayload: string, signature: string): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalPayload, "utf8"),
      publicKeyPem(),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Full independent re-verification of an attestation:
 *  1. signature is valid over the signable payload, and
 *  2. hash === sha256(prevHash || signable payload).
 */
export function verifyAttestation(att: Attestation): boolean {
  const payload: Omit<Attestation, "signature" | "hash"> = {
    id: att.id,
    type: att.type,
    status: att.status,
    reasonCode: att.reasonCode,
    reason: att.reason,
    evidence: att.evidence,
    signedAt: att.signedAt,
    prevHash: att.prevHash,
  };
  const canonical = signablePayload(payload);
  return (
    verifySignature(canonical, att.signature) &&
    att.hash === chainHash(att.prevHash, canonical)
  );
}
