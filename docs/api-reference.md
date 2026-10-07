# API reference (draft against contract v0.1)

Base URL: your Vercel deployment (e.g. `https://attestation.vercel.app`).
All bodies are JSON. All responses are JSON.

---

## POST /attestations — request verification and issue an attestation

Request body:

```json
{
  "type": "identity" | "payment" | "record",
  "subject": { "kind": "person" | "business" | "agent", "id": "..." },
  "payment": {
    "channel": "mpesa",
    "transactionCode": "QHX7...",
    "expectedAmount": 2500,
    "expectedRecipient": "567890",
    "orderRef": "TUMA-1042"
  },
  "record": { "hash": "sha256:...", "recordedBy": "..." }
}
```

- `type: "payment"` requires `payment`. v0.1 supports `channel: "mpesa"` only.
- `type: "record"` requires `record`.
- `type: "identity"` — v0.1 returns `501` (identity verification lands in v0.2).

Response — the attestation:

```json
{
  "id": "att_...",
  "type": "payment",
  "status": "verified" | "unverified" | "pending",
  "reasonCode": "MATCHED",
  "reason": "Transaction QHX7... matched: KSh 2,500 to Till 567890 at 14:32.",
  "evidence": { "transactionCode": "QHX7...", "amount": 2500, "sender": "2547***123" },
  "signedAt": "2026-10-06T09:00:00Z",
  "signature": "...",
  "prevHash": "...",
  "hash": "..."
}
```

Payment outcomes on request:

| reasonCode | status | meaning |
|---|---|---|
| `MATCHED` | verified | code + amount + recipient + recency all matched (Daraja lookup) |
| `AMOUNT_MISMATCH` | unverified | code found, amount differs from `expectedAmount` |
| `RECIPIENT_MISMATCH` | unverified | code found, recipient differs from `expectedRecipient` |
| `STALE` | unverified | transaction is >24h old |
| `DUPLICATE` | unverified | this `transactionCode` was already attested |
| `PENDING_CALLBACK` | pending | code not found yet — awaiting Safaricom C2B confirmation |

Record outcomes: `status: "verified"`, `reasonCode: "VERIFIED"` (the claim
recorded is *existence*, not correctness).

---

## GET /attestations/{id} — retrieve an attestation

Returns the attestation object. `404` when the id is unknown. Anyone can
re-verify the signature with the public key and `lib/sign.ts`'s
`verifyAttestation` — no API call needed beyond fetching the object.

---

## POST /webhooks — register a callback URL

Provide `WEBHOOK_ADMIN_SECRET` as a bearer token in the `Authorization` header. Requests with a
missing or invalid bearer token return `401`; if `WEBHOOK_ADMIN_SECRET` is not
configured, registration is disabled and returns `503`.

```json
{ "url": "https://your-app.example/hooks/attestations", "events": ["attestation.completed", "attestation.failed"] }
```

Events:

- `attestation.completed` — a `pending` attestation became `verified`
- `attestation.failed` — a `pending` attestation became `unverified`

Payload for both events: `{ "event": "<name>", "attestation": { ... } }`.
Deliveries time out after 10s with one retry. Respond `2xx` quickly.

---

## POST /mpesa/c2b/callback — Safaricom C2B confirmation ingress

Receives Safaricom's real-time payment confirmations. Always respond with:

```json
{ "ResultCode": 0, "ResultDesc": "Accepted" }
```

Ingress fields consumed:

| field | used for |
|---|---|
| `TransactionID` | Safaricom receipt code (evidence) |
| `TransactionAmount` | compared against `expectedAmount` |
| `BillRefNumber` | matched to the open payment attestation's `orderRef` |
| `MSISDN` | masked into evidence as `sender` |
| `TransactionTime` | recency check (>24h → `STALE`) |
| `BusinessShortCode` | compared against `expectedRecipient` |

Matching logic:

1. Find the open (`pending`) payment attestation whose `orderRef` equals
   `BillRefNumber`. None → acknowledge, log unmatched (no state change).
2. `TransactionAmount != expectedAmount` → `unverified`, `AMOUNT_MISMATCH`.
3. `BusinessShortCode != expectedRecipient` → `unverified`, `RECIPIENT_MISMATCH`.
4. `TransactionTime` > 24h old → `unverified`, `STALE`.
5. Otherwise → `verified`, `MATCHED`; evidence records the Safaricom fields.

The status change fires `attestation.completed` or `attestation.failed` to
registered webhooks. **A payment is real iff Safaricom announced it** — the
C2B callback is the strongest verification signal in v0.1.

---

## Reason codes — machine-stable vs human-display-only

`reasonCode` is machine-readable and integration-safe: safe to branch on,
safe to persist, stable across versions. `reason` is human-readable and
display-only: it may be reworded at any time and must never drive logic.

Payment: `MATCHED`, `AMOUNT_MISMATCH`, `RECIPIENT_MISMATCH`,
`CODE_NOT_FOUND`, `STALE` (>24h old), `DUPLICATE`, `PENDING_CALLBACK`.

Identity: `VERIFIED`, `DOCUMENT_UNREADABLE`, `LIVENESS_FAILED` (v0.2+).

Record: `VERIFIED` (existence of the hash at `signedAt`).
