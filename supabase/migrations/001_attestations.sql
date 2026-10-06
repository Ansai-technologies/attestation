-- Attestation infrastructure v0.1 — Supabase schema
-- The attestations table is the tamper-evident log: each row stores
-- prev_hash + hash, chaining every attestation to the one before it.

create table if not exists attestations (
  id          text primary key,
  type        text not null check (type in ('identity', 'payment', 'record')),
  subject_kind text not null,
  subject_id  text not null,
  payment_code text,              -- M-Pesa transaction code (payment attestations)
  order_ref   text,               -- merchant order ref; matched to C2B BillRefNumber
  status      text not null check (status in ('verified', 'unverified', 'pending')),
  reason_code text not null,
  reason      text not null,      -- human-readable, display-only
  evidence    jsonb not null default '{}',
  signed_at   timestamptz not null,
  signature   text not null,      -- Ed25519 over canonical payload
  prev_hash   text not null,      -- hash of previous entry ("GENESIS" first)
  hash        text not null,      -- sha256(prev_hash || canonical payload)
  created_at  timestamptz not null default now()
);

-- Chain integrity: every hash is unique in the log.
create unique index if not exists attestations_hash_uidx on attestations (hash);
create index if not exists attestations_status_idx on attestations (status);
create index if not exists attestations_order_ref_idx on attestations (order_ref) where status = 'pending';
create index if not exists attestations_payment_code_idx on attestations (payment_code);

-- Webhook registrations for attestation.completed / attestation.failed.
create table if not exists webhooks (
  id         uuid primary key default gen_random_uuid(),
  url        text not null,
  events     text[] not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
