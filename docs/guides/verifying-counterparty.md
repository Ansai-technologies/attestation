# Guide: verifying a counterparty — identity attestations (draft against contract v0.1)

Identity attestations answer: *is this counterparty who they claim to be?*
The **subject** is the entity being verified:

```json
{ "kind": "person" | "business" | "agent", "id": "..." }
```

- `person` — an individual (buyer, vendor, field officer).
- `business` — a registered entity (till owner, supplier, school).
- `agent` — a software agent acting on someone's behalf (v0.2+).

## What the reason codes mean

| reasonCode | status | meaning |
|---|---|---|
| `VERIFIED` | verified | the identity claim checked out against the evidence |
| `DOCUMENT_UNREADABLE` | unverified | the submitted document couldn't be read — ask for a clearer capture |
| `LIVENESS_FAILED` | unverified | liveness check failed — possible spoofing |

Machine rule (as everywhere): branch on `reasonCode`, never on the human
`reason` string.

## v0.1 scope

Identity verification mechanics (document OCR, liveness) land in **v0.2**.
In v0.1, `POST /attestations` with `type: "identity"` returns `501`:

```json
{ "error": "identity attestation is not implemented in v0.1 (lands in v0.2)" }
```

What you can do today: model counterparties as subjects on payment and
record attestations — the subject (`person`/`business`/`agent` + id) is
part of every attestation, so identity evidence you already hold (KYC'd
MSISDN, business registration, prior payment history) rides along in the
audit trail from day one.
