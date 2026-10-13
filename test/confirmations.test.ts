/**
 * Confirmation-ledger tests (in-memory store; no Supabase, no Daraja).
 * Run: npm test  →  tsc && node --test dist/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "../lib/store.js";
import { confirmationFromCallback, evaluateConfirmation } from "../lib/confirmations.js";
import type { PaymentRequest } from "../lib/types.js";

const RECEIVED_AT = "2026-10-13T09:00:00.000Z";

function darajaTime(d: Date): string {
  // Daraja TransTime is EAT wall-clock, YYYYMMDDHHmmss.
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}` +
    `${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`
  );
}

function callbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    TransactionType: "Pay Bill",
    TransID: "RKX123ABC9",
    TransTime: darajaTime(new Date()),
    TransAmount: "100.00",
    BusinessShortCode: "600987",
    BillRefNumber: "TUMA-FLOW-01",
    MSISDN: "254708374149",
    ...overrides,
  };
}

const payment: PaymentRequest = {
  channel: "mpesa",
  transactionCode: "RKX123ABC9",
  expectedAmount: 100,
  expectedRecipient: "600987",
  orderRef: "TUMA-FLOW-01",
};

test("confirmationFromCallback builds a ledger entry from a Daraja payload", () => {
  const conf = confirmationFromCallback(callbackPayload(), RECEIVED_AT);
  assert.ok(conf);
  assert.equal(conf.transId, "RKX123ABC9");
  assert.equal(conf.amount, 100);
  assert.equal(conf.businessShortCode, "600987");
  assert.equal(conf.billRefNumber, "TUMA-FLOW-01");
  assert.equal(conf.receivedAt, RECEIVED_AT);
});

test("confirmationFromCallback rejects payloads without a usable receipt", () => {
  assert.equal(confirmationFromCallback(callbackPayload({ TransID: "" }), RECEIVED_AT), null);
  assert.equal(confirmationFromCallback(callbackPayload({ TransAmount: "abc" }), RECEIVED_AT), null);
  assert.equal(confirmationFromCallback(callbackPayload({ BillRefNumber: "" }), RECEIVED_AT), null);
});

test("a filed confirmation matching the payment verifies as MATCHED", () => {
  const conf = confirmationFromCallback(callbackPayload(), RECEIVED_AT);
  assert.ok(conf);
  const v = evaluateConfirmation(payment, conf);
  assert.equal(v.status, "verified");
  assert.equal(v.reasonCode, "MATCHED");
  assert.equal(v.evidence.safaricomConfirmed, true);
  assert.equal(v.evidence.amount, 100);
});

test("amount disagreement against the filed receipt is AMOUNT_MISMATCH with real numbers", () => {
  const conf = confirmationFromCallback(callbackPayload({ TransAmount: "250.00" }), RECEIVED_AT);
  assert.ok(conf);
  const v = evaluateConfirmation(payment, conf);
  assert.equal(v.status, "unverified");
  assert.equal(v.reasonCode, "AMOUNT_MISMATCH");
  assert.equal(v.evidence.actualAmount, 250);
});

test("recipient disagreement against the filed receipt is RECIPIENT_MISMATCH", () => {
  const conf = confirmationFromCallback(callbackPayload({ BusinessShortCode: "174379" }), RECEIVED_AT);
  assert.ok(conf);
  const v = evaluateConfirmation(payment, conf);
  assert.equal(v.status, "unverified");
  assert.equal(v.reasonCode, "RECIPIENT_MISMATCH");
});

test("a filed confirmation older than 24h is STALE", () => {
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const conf = confirmationFromCallback(callbackPayload({ TransTime: darajaTime(old) }), RECEIVED_AT);
  assert.ok(conf);
  const v = evaluateConfirmation(payment, conf);
  assert.equal(v.status, "unverified");
  assert.equal(v.reasonCode, "STALE");
});

test("the in-memory ledger files idempotently and finds by TransID", async () => {
  const store = new InMemoryStore();
  const conf = confirmationFromCallback(callbackPayload(), RECEIVED_AT);
  assert.ok(conf);
  await store.recordConfirmation(conf);
  // A redelivery of the same confirmation must not overwrite the first filing.
  await store.recordConfirmation({ ...conf, amount: 999 });
  const found = await store.findConfirmationByTransId("RKX123ABC9");
  assert.ok(found);
  assert.equal(found.amount, 100);
  assert.equal(await store.findConfirmationByTransId("NOPE000000"), null);
});
