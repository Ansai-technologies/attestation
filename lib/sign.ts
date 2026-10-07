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

/**
 * Paste-proof PEM ingestion.
 *
 * Secrets pasted through dashboards, terminals and editors arrive with
 * creative newline mangling (real LF/CRLF, literal \n sequences, or newlines
 * collapsed to spaces). Rebuild a canonical PEM from the headers plus the
 * base64 body whenever both are present; otherwise throw a descriptive error
 * carrying non-secret metadata only, so the next failure names itself
 * instead of surfacing a raw OpenSSL decoder error.
 */
function normalizePem(raw: string, label: string, expectedKind: string): string {
  const text = raw.replace(/\\n/g, "\n");
  const m = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) {
    const newlines = (text.match(/\n/g) || []).length;
    throw new Error(
      `${label}: no PEM block found (length=${text.length}, newlines=${newlines}). ` +
        `Expected "-----BEGIN ${expectedKind}-----" … "-----END ${expectedKind}-----".`,
    );
  }
  if (m[1] !== expectedKind) {
    throw new Error(
      `${label}: header is "-----BEGIN ${m[1]}-----", expected "-----BEGIN ${expectedKind}-----" — the keys may be swapped.`,
    );
  }
  const body = m[2].replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(body) || body.length < 16) {
    throw new Error(`${label}: PEM body is not valid base64 (length=${body.length}).`);
  }
  return `-----BEGIN ${m[1]}-----\n${body}\n-----END ${m[1]}-----\n`;
}

function privateKeyPem(): string {
  const pem = process.env.ED25519_PRIVATE_KEY_PEM;
  if (!pem) throw new Error("ED25519_PRIVATE_KEY_PEM is not configured");
  return normalizePem(pem, "ED25519_PRIVATE_KEY_PEM", "PRIVATE KEY");
}

function publicKeyPem(): string {
  const pem = process.env.ED25519_PUBLIC_KEY_PEM;
  if (!pem) throw new Error("ED25519_PUBLIC_KEY_PEM is not configured");
  return normalizePem(pem, "ED25519_PUBLIC_KEY_PEM", "PUBLIC KEY");
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
