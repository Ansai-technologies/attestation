# Attestation Infrastructure — engineering docs (draft against contract v0.1)

Internal engineering source of truth for the Ansai Trust Engine v0.1 core.
Written for engineers building against the contract — including future
Muse Code sessions.

## Naming rule (decided 2026-10-06, frozen)

- **Trust Engine** — product language. Buyer-facing, outcome-first. Used in
  marketing, decks, and customer copy.
- **attestation infrastructure** — engineering language. Used in docs, API,
  code, and commit messages. Mechanism-first.
- **attestation** — the bridge noun. Identical in marketing copy and API.
  Never translated, never renamed. Endpoint and resource names stay stable
  while marketing may rebrand around them.

## The contract

The frozen v0.1 contract all tracks build against lives outside the repo:

- `~/workspace/drafts/attestation-api-contract-v0.1.md` (workspace drafts, not committed here — it is the shared frozen source for all four tracks)

These docs describe that contract. If they ever disagree, the contract wins.

## Contents

- [Concepts](concepts.md) — primitives, what an attestation is, lifecycle
- [API reference](api-reference.md) — endpoints, shapes, reason codes
- Guides:
  - [Verifying an M-Pesa payment](guides/verifying-mpesa-payment.md)
  - [Verifying a counterparty (identity)](guides/verifying-counterparty.md)
  - [eTIMS-ready records](guides/etims-ready-records.md)

## Repo layout

```
api/            Vercel serverless functions (the four contract endpoints)
lib/            attest.ts (issuance + hash chain), sign.ts (Ed25519),
                store.ts (Supabase), daraja.ts (M-Pesa sandbox), webhooks.ts
supabase/       SQL migrations for the attestations + webhooks tables
docs/           these engineering docs
```
