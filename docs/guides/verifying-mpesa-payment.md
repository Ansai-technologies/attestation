# Guide: verifying an M-Pesa payment (draft against contract v0.1)

## The two mechanisms

1. **C2B callback (strongest).** For till/paybill payments, Safaricom pushes
   a real-time confirmation to `POST /mpesa/c2b/callback`. The engine matches
   it to the open payment attestation by `BillRefNumber` (= the `orderRef`
   you passed when requesting the attestation) plus amount. A payment is
   real iff Safaricom announced it.
2. **Transaction-status query (verify by buyer-supplied code).** The buyer
   pastes their M-Pesa receipt code (e.g. `QHX7123ABC`). The engine queries
   Daraja's transaction-status API (sandbox in v0.1) and compares the result
   against your expectations.

Request flow:

```json
POST /attestations
{
  "type": "payment",
  "subject": { "kind": "person", "id": "buyer-254712345678" },
  "payment": {
    "channel": "mpesa",
    "transactionCode": "QHX7123ABC",
    "expectedAmount": 2500,
    "expectedRecipient": "567890",
    "orderRef": "TUMA-1042"
  }
}
```

- Daraja confirms the code and everything matches →
  `{"status": "verified", "reasonCode": "MATCHED", ...}`.
- Daraja has no record of the code yet → `{"status": "pending",
  "reasonCode": "PENDING_CALLBACK", ...}`. When the C2B confirmation lands,
  the attestation completes and `attestation.completed` fires to your
  webhook.

## Matching rules

A payment attestation verifies only when **all four** hold:

| dimension | rule |
|---|---|
| code | `transactionCode` (or C2B `TransactionID`) is a real Safaricom receipt |
| amount | equals `expectedAmount` exactly — else `AMOUNT_MISMATCH` |
| recipient | till/paybill equals `expectedRecipient` — else `RECIPIENT_MISMATCH` |
| recency | transaction is ≤ 24h old — else `STALE` |

Additionally: a code that was already attested is `DUPLICATE` (replay
protection — the same receipt can't pay twice).

## P2P caveat

M-Pesa **send-money (P2P)** has no merchant callback — Safaricom sends
nothing to us. P2P payments are verify-by-lookup only: still far stronger
than a screenshot, but without the real-time C2B signal. Design your
checkout to prefer till/paybill (C2B) where verification matters.
