-- Confirmation ledger: every C2B receipt Safaricom delivers is filed here,
-- whether or not an attestation is waiting for it. A submitted transaction
-- code is judged against this table first (pay first, submit code second).

create table if not exists mpesa_confirmations (
  trans_id            text primary key,  -- Daraja TransID, unique per transaction
  amount              numeric not null,  -- TransAmount
  business_short_code text not null,     -- till / paybill that received the money
  bill_ref_number     text not null,     -- order reference quoted by the payer
  msisdn              text,              -- payer phone, as delivered by Safaricom
  trans_time          text,              -- Daraja TransTime (YYYYMMDDHHmmss, EAT)
  raw                 jsonb not null,    -- the callback payload, as delivered
  received_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists mpesa_confirmations_bill_ref_idx on mpesa_confirmations (bill_ref_number);
create index if not exists mpesa_confirmations_received_idx on mpesa_confirmations (received_at);

alter table if exists mpesa_confirmations enable row level security;
