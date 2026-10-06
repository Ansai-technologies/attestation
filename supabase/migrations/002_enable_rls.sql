-- Attestation infrastructure v0.1 hardening — enable Row Level Security.
--
-- No permissive policies are created: the anon/authenticated API keys get
-- nothing. The API authenticates with the service_role key, which bypasses
-- RLS, so this changes nothing for the service while closing the tables to
-- anyone holding only the publishable key.
--
-- Run in the Supabase dashboard: SQL Editor → paste → Run (same as 001).

alter table if exists attestations enable row level security;
alter table if exists webhooks enable row level security;
