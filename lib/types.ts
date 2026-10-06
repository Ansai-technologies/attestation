/** Shared types for the attestation infrastructure (Trust Engine v0.1). */

export type AttestationType = "identity" | "payment" | "record";
export type SubjectKind = "person" | "business" | "agent";
export type AttestationStatus = "verified" | "unverified" | "pending";

/** Machine-stable reason codes (integration-safe). Human `reason` is display-only. */
export const REASON_CODES = {
  payment: [
    "MATCHED",
    "AMOUNT_MISMATCH",
    "RECIPIENT_MISMATCH",
    "CODE_NOT_FOUND",
    "STALE",
    "DUPLICATE",
    "PENDING_CALLBACK",
  ],
  identity: ["VERIFIED", "DOCUMENT_UNREADABLE", "LIVENESS_FAILED"],
  record: ["VERIFIED"],
} as const;

export interface Subject {
  kind: SubjectKind;
  id: string;
}

export interface PaymentRequest {
  /** v0.1: only "mpesa" */
  channel: "mpesa";
  /** Buyer-supplied M-Pesa transaction code, e.g. "QHX7123ABC" */
  transactionCode: string;
  expectedAmount: number;
  /** Till / paybill number the money was expected to go to */
  expectedRecipient: string;
  /** Merchant order reference (doubles as BillRefNumber for C2B matching) */
  orderRef: string;
}

export interface RecordRequest {
  /** Content hash, e.g. "sha256:..." */
  hash: string;
  recordedBy: string;
}

export interface AttestationRequest {
  type: AttestationType;
  subject: Subject;
  payment?: PaymentRequest;
  record?: RecordRequest;
}

export interface Attestation {
  id: string;
  type: AttestationType;
  status: AttestationStatus;
  reasonCode: string;
  /** Human-readable, display-only. May change; never branch logic on it. */
  reason: string;
  evidence: Record<string, unknown>;
  signedAt: string;
  /** Ed25519 signature over the canonical attestation payload */
  signature: string;
  /** Hash of the previous chain entry ("GENESIS" for the first) */
  prevHash: string;
  /** sha256 over prevHash + canonical payload */
  hash: string;
}

export type WebhookEvent = "attestation.completed" | "attestation.failed";

export interface WebhookRegistration {
  url: string;
  events: WebhookEvent[];
}

/** Safaricom C2B confirmation payload (subset we consume). */
export interface C2BCallback {
  TransactionType: string;
  TransactionID: string;
  TransactionTime: string;
  TransactionAmount: number;
  BusinessShortCode: string;
  BillRefNumber: string;
  MSISDN: string;
  [k: string]: unknown;
}
