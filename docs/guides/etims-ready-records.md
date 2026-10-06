# Guide: eTIMS-ready records (draft against contract v0.1)

## Record-type attestations

A record attestation makes a narrow, powerful claim: *this exact content
existed at this time, attested by this party.* The engine does not judge
the content — it seals its existence.

```json
POST /attestations
{
  "type": "record",
  "subject": { "kind": "business", "id": "vendor-8821" },
  "record": {
    "hash": "sha256:9f2c…a1",
    "recordedBy": "tuma-pos/ke-nairobi-04"
  }
}
```

Response: `{"status": "verified", "reasonCode": "VERIFIED", ...}` — the hash
is now sealed in the log with a signature and timestamp.

Use it for invoices, receipts, delivery notes, stock counts — any document
whose later denial would cost money.

## The tamper-evident trail

Every attestation (record, payment, identity) is appended to the
hash-chained log: each entry carries `prevHash` + `hash` over its contents.
To prove a record's history to an auditor or the tax authority:

1. `GET /attestations/{id}` — fetch the attestation.
2. Re-verify the Ed25519 signature with the public key
   (`lib/sign.ts` → `verifyAttestation`).
3. Walk the chain: each entry's `hash` must equal
   `sha256(prevHash || canonical payload)`, and each `prevHash` must equal
   the previous entry's `hash`. Any alteration breaks the walk.

## How this feeds eTIMS-ready bookkeeping (Hazina)

Kenya's eTIMS requires fiscalised, sequenced, tamper-evident transaction
records. The attestation log is the raw material Hazina (the SME
bookkeeping build) will fiscalise against:

- **Sequencing** — the chain order is the canonical sequence; gaps and
  reorders are detectable.
- **Tamper evidence** — a record's hash can't be quietly rewritten.
- **Attribution** — `recordedBy` + `subject` say who stood behind the record.
- **Payment linkage** — payment attestations (`MATCHED` receipts) join to
  record attestations by `orderRef`, tying money movement to documents.

v0.1 ships the sealing primitive. Fiscalisation mappings and KRA
submission formats are a later track.
