/**
 * The confirmation ledger's verdict logic.
 *
 * Every C2B confirmation Safaricom delivers is filed (see the callback
 * handler); when a buyer later submits that transaction code, the payment is
 * judged against our own copy of the receipt before any Daraja lookup runs.
 *
 * The checks mirror the C2B callback's completion checks — amount, recipient,
 * recency — so both directions of the flow judge a payment the same way.
 * This module is pure (no I/O) so the verdict logic is unit-testable.
 */
import type { C2BCallback, MpesaConfirmation, PaymentRequest } from "./types.js";
import { parseDarajaTransTime } from "./daraja.js";

/** Build a ledger entry from a C2B payload; null when it carries no usable receipt. */
export function confirmationFromCallback(
  cb: Partial<C2BCallback>,
  receivedAt: string,
): MpesaConfirmation | null {
  const transId = cb?.TransID ? String(cb.TransID) : "";
  const amount = Number(cb?.TransAmount);
  const billRefNumber = cb?.BillRefNumber ? String(cb.BillRefNumber) : "";
  if (!transId || !Number.isFinite(amount) || !billRefNumber) return null;
  return {
    transId,
    amount,
    businessShortCode: cb?.BusinessShortCode ? String(cb.BusinessShortCode) : "",
    billRefNumber,
    msisdn: cb?.MSISDN ? String(cb.MSISDN) : undefined,
    transTime: cb?.TransTime ? String(cb.TransTime) : undefined,
    raw: cb as Record<string, unknown>,
    receivedAt,
  };
}

export interface ConfirmationVerdict {
  status: "verified" | "unverified";
  reasonCode: "MATCHED" | "AMOUNT_MISMATCH" | "RECIPIENT_MISMATCH" | "STALE";
  reason: string;
  evidence: Record<string, unknown>;
}

/** Judge a payment request against a filed confirmation of the same code. */
export function evaluateConfirmation(
  payment: PaymentRequest,
  conf: MpesaConfirmation,
): ConfirmationVerdict {
  const base: Record<string, unknown> = {
    transactionCode: payment.transactionCode,
    orderRef: payment.orderRef,
    confirmationBillRef: conf.billRefNumber,
    confirmationReceivedAt: conf.receivedAt,
    safaricomConfirmed: true,
  };
  if (conf.amount !== payment.expectedAmount) {
    return {
      status: "unverified",
      reasonCode: "AMOUNT_MISMATCH",
      reason: `Transaction ${payment.transactionCode} amount (KSh ${conf.amount}) does not match expected KSh ${payment.expectedAmount}.`,
      evidence: { ...base, expectedAmount: payment.expectedAmount, actualAmount: conf.amount },
    };
  }
  if (conf.businessShortCode && conf.businessShortCode !== payment.expectedRecipient) {
    return {
      status: "unverified",
      reasonCode: "RECIPIENT_MISMATCH",
      reason: `Transaction ${payment.transactionCode} recipient ${conf.businessShortCode} does not match ${payment.expectedRecipient}.`,
      evidence: {
        ...base,
        expectedRecipient: payment.expectedRecipient,
        actualRecipient: conf.businessShortCode,
      },
    };
  }
  if (conf.transTime) {
    const t = parseDarajaTransTime(conf.transTime);
    if (!Number.isNaN(t.getTime()) && Date.now() - t.getTime() > 24 * 60 * 60 * 1000) {
      return {
        status: "unverified",
        reasonCode: "STALE",
        reason: `Transaction ${payment.transactionCode} is older than 24h.`,
        evidence: { ...base, transactionTime: conf.transTime },
      };
    }
  }
  return {
    status: "verified",
    reasonCode: "MATCHED",
    reason: `Transaction ${payment.transactionCode} matched: KSh ${conf.amount} to ${conf.businessShortCode} (Safaricom confirmation on file).`,
    evidence: {
      ...base,
      amount: conf.amount,
      recipient: conf.businessShortCode,
      transactionTime: conf.transTime,
    },
  };
}
