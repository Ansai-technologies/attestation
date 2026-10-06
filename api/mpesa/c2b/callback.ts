/**
 * POST /mpesa/c2b/callback — Safaricom C2B confirmation ingress.
 *
 * A payment is real iff Safaricom announced it. This handler matches the
 * confirmation to the open (pending) payment attestation by
 * BillRefNumber/orderRef + amount, completes it, and dispatches webhooks.
 *
 * Always answers Safaricom with {"ResultCode":0,"ResultDesc":"Accepted"} on
 * a parseable payload — we never 4xx the network operator; mismatches are
 * recorded as unverified attestations, not transport errors.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStore, StorageUnavailableError } from "../../../lib/store.js";
import { dispatch, eventFor } from "../../../lib/webhooks.js";
import type { C2BCallback } from "../../../lib/types.js";

function maskMsisdn(msisdn: string): string {
  if (msisdn.length <= 6) return "***";
  return `${msisdn.slice(0, 4)}***${msisdn.slice(-3)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const cb = req.body as Partial<C2BCallback> | undefined;

  const txnId = cb?.TransactionID;
  const amount = Number(cb?.TransactionAmount);
  const billRef = cb?.BillRefNumber;
  if (!txnId || !Number.isFinite(amount) || !billRef) {
    // Unparseable — still ack Safaricom, but nothing to match.
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  let store;
  try {
    store = getStore();
  } catch (e) {
    if (e instanceof StorageUnavailableError) {
      console.error("C2B callback dropped: store unavailable", e.message);
    }
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  const open = await store.findOpenByOrderRef(String(billRef));
  if (!open) {
    console.warn("C2B callback with no open attestation", { txnId, billRef, amount });
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  const evidence = open.evidence as Record<string, unknown>;
  const expectedAmount = Number(evidence.expectedAmount);
  const expectedRecipient = String(evidence.expectedRecipient ?? "");
  const sender = cb?.MSISDN ? maskMsisdn(String(cb.MSISDN)) : undefined;
  const txnTime = cb?.TransactionTime ? String(cb.TransactionTime) : undefined;

  let status: "verified" | "unverified" = "verified";
  let reasonCode = "MATCHED";
  let reason = `Transaction ${txnId} matched: KSh ${amount} to ${cb?.BusinessShortCode ?? ""}.`;

  if (Number.isFinite(expectedAmount) && amount !== expectedAmount) {
    status = "unverified";
    reasonCode = "AMOUNT_MISMATCH";
    reason = `C2B confirmation for order ${billRef}: amount KSh ${amount} does not match expected KSh ${expectedAmount}.`;
  } else if (expectedRecipient && cb?.BusinessShortCode && String(cb.BusinessShortCode) !== expectedRecipient) {
    status = "unverified";
    reasonCode = "RECIPIENT_MISMATCH";
    reason = `C2B confirmation for order ${billRef}: recipient ${cb.BusinessShortCode} does not match expected ${expectedRecipient}.`;
  } else if (txnTime) {
    const t = new Date(
      `${txnTime.slice(0, 4)}-${txnTime.slice(4, 6)}-${txnTime.slice(6, 8)}T${txnTime.slice(8, 10)}:${txnTime.slice(10, 12)}:${txnTime.slice(12, 14)}Z`,
    );
    if (!Number.isNaN(t.getTime()) && Date.now() - t.getTime() > 24 * 60 * 60 * 1000) {
      status = "unverified";
      reasonCode = "STALE";
      reason = `C2B confirmation for order ${billRef} is older than 24h.`;
    }
  }

  const updated = await store.updateStatus(open.id, {
    status,
    reasonCode,
    reason,
    evidence: {
      ...evidence,
      transactionCode: txnId,
      amount,
      sender,
      transactionTime: txnTime,
      safaricomConfirmed: true,
    },
  });

  if (updated) {
    const event = eventFor(updated.status);
    if (event) void dispatch(store, event, updated);
  }
  return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
}
