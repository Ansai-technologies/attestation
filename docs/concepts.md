# Concepts (draft against contract v0.1)

## The four primitives

The trust infrastructure productizes four primitives. Every product is a
different face of them (Tuma = commerce, EduManage = institutions,
ArdhiX = land):

1. **Verified identity** — a claim that a person, business, or agent is who
   they say they are, checked against evidence.
2. **Tamper-evident records** — a claim that a record existed in a given
   state at a given time, chained so any alteration is detectable.
3. **Payment verification** — a claim that money moved: from whom, to whom,
   how much, under which transaction code.
4. **Audit trails** — the running, hash-chained history of the above: who
   attested what, when, with what evidence.

## What an attestation is

An attestation is a **signed, checkable, hash-chained proof object**:

- **Signed** — Ed25519 signature over a canonical payload. Anyone with the
  public key can re-verify the signature without calling us.
- **Checkable** — carries a machine-stable `reasonCode` (integration-safe)
  and a human `reason` (display-only, may change).
- **Hash-chained** — each entry stores `prevHash` + `hash` over the entry
  contents. Altering any entry breaks the chain; the whole log is
  self-auditing.

Shape (contract v0.1):

```json
{
  "id": "att_...",
  "type": "payment",
  "status": "verified",
  "reasonCode": "MATCHED",
  "reason": "Transaction QHX7... matched: KSh 2,500 to Till 567890 at 14:32.",
  "evidence": { "transactionCode": "QHX7...", "amount": 2500, "sender": "2547***123" },
  "signedAt": "2026-10-06T09:00:00Z",
  "signature": "...",
  "prevHash": "...",
  "hash": "..."
}
```

## The attestation lifecycle

```
request → verify → sign → log → check
```

1. **Request** — a caller POSTs `/attestations` with `type`, `subject`,
   and the type-specific payload (`payment` / `record`). The engine creates
   an attestation record.
2. **Verify** — the engine runs the type's verification mechanism:
   - payment: M-Pesa C2B callback match, or Daraja transaction-status lookup
     by buyer-supplied code (see
     [Verifying an M-Pesa payment](guides/verifying-mpesa-payment.md)).
   - record: the content hash is recorded as-is (the claim is *existence*,
     not correctness).
   - identity: document/liveness checks — lands in v0.2.
   - Outcome is one of `verified` / `unverified` / `pending`, with a
     machine-stable `reasonCode`.
3. **Sign** — the engine Ed25519-signs the canonical payload. The signature
   is the engine's word: "we checked this."
4. **Log** — the attestation is appended to the hash-chained log
   (`prevHash` + `hash`). This is the tamper-evident trail.
5. **Check** — anyone can GET `/attestations/{id}` and re-verify the
   signature and chain position independently.

`pending` attestations may complete later (e.g. when the Safaricom C2B
callback arrives); completion fires webhooks
(`attestation.completed` / `attestation.failed`).
