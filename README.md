# Attestation — Trust Engine v0.1 core

**Attestation infrastructure**: the engineering layer behind the
**Trust Engine** (product language). See `docs/` for the internal
engineering source of truth.

## What it does

Issues **attestations** — signed, checkable, hash-chained proof objects —
for identity claims, M-Pesa payments, and tamper-evident records:

- `POST /attestations` — request verification, get an attestation
- `GET /attestations/{id}` — retrieve an attestation (re-verifyable by anyone)
- `POST /webhooks` — register callbacks for `attestation.completed` / `attestation.failed`
- `POST /mpesa/c2b/callback` — Safaricom C2B confirmation ingress

Every attestation is Ed25519-signed and appended to a hash-chained log
(`prevHash` + `hash`) in Supabase — altering any entry breaks the chain.

## Stack

TypeScript · Vercel serverless functions · Supabase · Daraja (sandbox first).

## Setup

```bash
cp .env.example .env   # fill in values — NEVER commit .env
npm install
npm run dev            # vercel dev
```

Required env (all placeholders in `.env.example`, no real keys in this repo):

| var | purpose |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | hash-chained log + webhooks |
| `ED25519_PRIVATE_KEY_PEM` / `ED25519_PUBLIC_KEY_PEM` | attestation signing |
| `DARAJA_CONSUMER_KEY` / `DARAJA_CONSUMER_SECRET` / `DARAJA_SHORTCODE` | M-Pesa sandbox (transaction-status lookup) |
| `DARAJA_SECURITY_CREDENTIAL` | encrypted initiator password for status queries |

Generate a dev keypair:

```bash
node -e "const{generateKeyPairSync}=require('crypto');
const k=generateKeyPairSync('ed25519');
console.log(k.privateKey.export({type:'pkcs8',format:'pem'}));
console.log(k.publicKey.export({type:'spki',format:'pem'}));"
```

Run migrations: `supabase/migrations/001_attestations.sql` in the Supabase
SQL editor (project TBD — see open items below).

## Tests

```bash
npm test   # tsc build + node --test over dist/test (in-memory store)
```

## Contract

Frozen v0.1 contract: `~/workspace/drafts/attestation-api-contract-v0.1.md`
(workspace drafts, not in this repo). Internal engineering docs: `docs/`.

## Non-goals for v0.1

Permission envelopes, media provenance, attested credentials, audit-agent.
Identity verification mechanics land in v0.2.
