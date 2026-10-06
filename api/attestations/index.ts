/**
 * POST /attestations — request verification and issue an attestation.
 *
 * Payment flow (v0.1):
 *  - DUPLICATE: transactionCode already attested → unverified
 *  - Daraja transaction-status lookup by buyer-supplied code:
 *      matched → verified / MATCHED
 *      amount mismatch → unverified / AMOUNT_MISMATCH
 *      recipient mismatch → unverified / RECIPIENT_MISMATCH
 *      >24h old → unverified / STALE
 *      code not found → pending / PENDING_CALLBACK (C2B callback may complete it)
 * Record flow: verified / VERIFIED (existence sealed).
 * Identity flow: 501 in v0.1 (lands in v0.2).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AttestationRequest, PaymentRequest } from "../../lib/types.js";
import { issueAttestation } from "../../lib/attest.js";
import { getStore, StorageUnavailableError } from "../../lib/store.js";
import { verifyPaymentByLookup } from "../../lib/daraja.js";
import { dispatch, eventFor } from "../../lib/webhooks.js";

function bad(res: VercelResponse, code: number, msg: string) {
  return res.status(code).json({ error: msg });
}

function validatePayment(p: unknown): p is PaymentRequest {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    o.channel === "mpesa" &&
    typeof o.transactionCode === "string" &&
    o.transactionCode.length > 0 &&
    typeof o.expectedAmount === "number" &&
    o.expectedAmount > 0 &&
    typeof o.expectedRecipient === "string" &&
    o.expectedRecipient.length > 0 &&
    typeof o.orderRef === "string" &&
    o.orderRef.length > 0
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return bad(res, 405, "method not allowed");
  const body = req.body as Partial<AttestationRequest> | undefined;
  if (!body || !body.type || !body.subject) {
    return bad(res, 400, "body must include type and subject");
  }
  const { type, subject } = body;
  if (!["identity", "payment", "record"].includes(type)) {
    return bad(res, 400, `unknown type "${type}"`);
  }
  if (!["person", "business", "agent"].includes(subject.kind) || !subject.id) {
    return bad(res, 400, "subject must be { kind: person|business|agent, id }");
  }

  let store;
  try {
    store = getStore();
  } catch (e) {
    if (e instanceof StorageUnavailableError) return bad(res, e.status, e.message);
    throw e;
  }

  // --- identity: v0.2 ---
  if (type === "identity") {
    return bad(res, 501, "identity attestation is not implemented in v0.1 (lands in v0.2)");
  }

  // --- record: seal the hash ---
  if (type === "record") {
    if (!body.record?.hash || !body.record?.recordedBy) {
      return bad(res, 400, "record requires { hash, recordedBy }");
    }
    const att = await issueAttestation(store, subject, {
      type,
      status: "verified",
      reasonCode: "VERIFIED",
      reason: `Record ${body.record.hash.slice(0, 20)}… attested by ${body.record.recordedBy}.`,
      evidence: { hash: body.record.hash, recordedBy: body.record.recordedBy },
    });
    const event = eventFor(att.status);
    if (event) void dispatch(store, event, att);
    return res.status(201).json(att);
  }

  // --- payment ---
  if (!validatePayment(body.payment)) {
    return bad(
      res,
      400,
      "payment requires { channel: 'mpesa', transactionCode, expectedAmount, expectedRecipient, orderRef }",
    );
  }
  const payment = body.payment;

  // Replay protection: same code can't pay twice.
  const prior = await store.findByTransactionCode(payment.transactionCode);
  if (prior.length > 0) {
    const att = await issueAttestation(store, subject, {
      type,
      status: "unverified",
      reasonCode: "DUPLICATE",
      reason: `Transaction code ${payment.transactionCode} was already attested (${prior[0].id}).`,
      evidence: {
        transactionCode: payment.transactionCode,
        orderRef: payment.orderRef,
        priorAttestationId: prior[0].id,
      },
    });
    const event = eventFor(att.status);
    if (event) void dispatch(store, event, att);
    return res.status(201).json(att);
  }

  try {
    const verdict = await verifyPaymentByLookup(payment);
    if (verdict.mode === "awaiting-callback" || !verdict.found) {
      const att = await issueAttestation(store, subject, {
        type,
        status: "pending",
        reasonCode: "PENDING_CALLBACK",
        reason: `Code ${payment.transactionCode} not found yet — awaiting Safaricom C2B confirmation for order ${payment.orderRef}.`,
        evidence: {
          transactionCode: payment.transactionCode,
          orderRef: payment.orderRef,
          expectedAmount: payment.expectedAmount,
          expectedRecipient: payment.expectedRecipient,
        },
      });
      return res.status(201).json(att);
    }
    if (verdict.stale) {
      const att = await issueAttestation(store, subject, {
        type,
        status: "unverified",
        reasonCode: "STALE",
        reason: `Transaction ${payment.transactionCode} is older than 24h.`,
        evidence: {
          transactionCode: payment.transactionCode,
          orderRef: payment.orderRef,
          transactionTime: verdict.transactionTime,
        },
      });
      const event = eventFor(att.status);
      if (event) void dispatch(store, event, att);
      return res.status(201).json(att);
    }
    if (!verdict.matchedAmount) {
      const att = await issueAttestation(store, subject, {
        type,
        status: "unverified",
        reasonCode: "AMOUNT_MISMATCH",
        reason: `Transaction ${payment.transactionCode} amount (${verdict.amount ?? "unknown"}) does not match expected KSh ${payment.expectedAmount}.`,
        evidence: {
          transactionCode: payment.transactionCode,
          orderRef: payment.orderRef,
          expectedAmount: payment.expectedAmount,
          actualAmount: verdict.amount,
        },
      });
      const event = eventFor(att.status);
      if (event) void dispatch(store, event, att);
      return res.status(201).json(att);
    }
    if (!verdict.matchedRecipient) {
      const att = await issueAttestation(store, subject, {
        type,
        status: "unverified",
        reasonCode: "RECIPIENT_MISMATCH",
        reason: `Transaction ${payment.transactionCode} recipient does not match ${payment.expectedRecipient}.`,
        evidence: {
          transactionCode: payment.transactionCode,
          orderRef: payment.orderRef,
          expectedRecipient: payment.expectedRecipient,
        },
      });
      const event = eventFor(att.status);
      if (event) void dispatch(store, event, att);
      return res.status(201).json(att);
    }
    const att = await issueAttestation(store, subject, {
      type,
      status: "verified",
      reasonCode: "MATCHED",
      reason: `Transaction ${payment.transactionCode} matched: KSh ${payment.expectedAmount} to ${payment.expectedRecipient}.`,
      evidence: {
        transactionCode: payment.transactionCode,
        orderRef: payment.orderRef,
        amount: verdict.amount ?? payment.expectedAmount,
        recipient: payment.expectedRecipient,
        transactionTime: verdict.transactionTime,
      },
    });
    const event = eventFor(att.status);
    if (event) void dispatch(store, event, att);
    return res.status(201).json(att);
  } catch (e) {
    // Daraja unreachable / misconfigured: degrade to pending rather than fail.
    const att = await issueAttestation(store, subject, {
      type,
      status: "pending",
      reasonCode: "PENDING_CALLBACK",
      reason: `Verification lookup unavailable (${(e as Error).message.slice(0, 120)}) — awaiting Safaricom C2B confirmation for order ${payment.orderRef}.`,
      evidence: {
        transactionCode: payment.transactionCode,
        orderRef: payment.orderRef,
        expectedAmount: payment.expectedAmount,
        expectedRecipient: payment.expectedRecipient,
      },
    });
    return res.status(201).json(att);
  }
}
