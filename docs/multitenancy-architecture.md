# Multi-tenancy architecture (future — v0.2+)

How the attestation infrastructure grows from Ansai's internal trust service
(v0.1, single-tenant) into a platform external builders can sign up for.

## Where we are (v0.1)

Single tenant: one Ed25519 keypair, one `attestations` table, no tenant
concept. Tuma, EduManage, Hazina and ArdhiX share the service and namespace
their records through `subject` (each product uses its own subject
kinds/ids). The trust claim is **"Ansai vouches for this record"** — correct
while every face of the engine belongs to us.

Nothing about v0.1 blocks the products: they can issue attestations today.

## Why multi-tenancy, and when

Multi-tenancy becomes necessary the day an **external** builder needs their
own signing key and isolated data — someone who does not want Ansai holding
the pen. Until that customer exists, v0.1's model is sufficient and simpler.
Do not build it speculatively; build it when the first external tenant signs.

## Target design

### Tenants
- `tenants` table: `id`, `name`, `status`, `created_at`.
- Every attestation and webhook row carries `tenant_id`, defaulting to
  `'ansai'`. v0.1 rows backfill to the `ansai` tenant — history is preserved,
  nothing is rewritten.

### Keys
- Per-tenant Ed25519 keypair. Custodial first: the platform generates and
  holds them; tenants fetch their **public** key and verify independently.
- `tenant_keys`: `tenant_id`, `public_key_pem`, `created_at`, `rotated_at`.
- Private keys must move out of env vars (one var per tenant does not scale)
  into a secrets manager or per-tenant encrypted rows. Key rotation is a
  first-class operation, not an incident.

### Auth
- Per-tenant API keys: `tenant_api_keys` (`id`, `tenant_id`, `key_hash`,
  `name`, `created_at`, `revoked_at`). Only hashes are stored.
- `Authorization: Bearer <tenant-api-key>` on issuance endpoints.
- Reads stay public. Anyone can verify an attestation — that is the point.

### Isolation
Defense in depth, in this order:
1. App-level `tenant_id` scoping on every query (the primary mechanism).
2. Supabase RLS policies keyed off the tenant as the backstop, so a missing
   `WHERE` clause can never leak rows across tenants. (v0.1 already enables
   RLS with no permissive policies; v0.2 adds tenant-scoped policies.)

### Surfaces
- **Tenant portal** — login per tenant: their attestations only, key
  rotation, webhook management, usage metering.
- **Ops console** (internal) — all tenants at a glance, system health,
  request volume, per-tenant drill-down. The "show the investor" screen.
- **Public** — `/status` and `/explorer` stay cross-tenant. Verification is
  public; only issuance and management are tenant-scoped.

### Chain scope (decision)
One global hash chain, not per-tenant chains. `tenant_id` is a label on each
record, not a fork in the chain. Cross-tenant tamper-evidence is stronger:
rewriting history would require rewriting everyone else's records too.

## Migration path (v0.1 → v0.2)

1. Migration `003`: add `tenant_id` columns (default `'ansai'`); create
   `tenants`, `tenant_keys`, `tenant_api_keys`.
2. Backfill existing rows to the `ansai` tenant.
3. Dual-write: issuance stamps `tenant_id`; reads unchanged.
4. Cut over: require tenant API key on `POST /attestations` (grace window
   for existing integrations).
5. Ship the tenant portal, then the ops console.

## Open decisions (not yet taken)
- Custodial keys vs bring-your-own-key → start custodial, BYOK later.
- Billing/metering per attestation → out of v0.2 scope.
- Tenant signup flow (self-serve vs sales-led) → decide with the first tenant.
