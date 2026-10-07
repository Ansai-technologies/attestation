-- Callback completions are new, linked attestations; the pending row is immutable.
create unique index if not exists attestations_supersedes_uidx
  on attestations ((evidence ->> 'supersedesAttestationId'))
  where evidence ? 'supersedesAttestationId';

create or replace function append_attestation_completion(
  p_parent_id text,
  p_attestation jsonb
)
returns setof attestations
language plpgsql
security invoker
as $$
declare
  parent attestations%rowtype;
begin
  select * into parent
  from attestations
  where id = p_parent_id
  for update;

  if not found or parent.status <> 'pending' then
    return;
  end if;

  if p_attestation -> 'evidence' ->> 'supersedesAttestationId' is distinct from p_parent_id then
    raise exception 'completion must reference its pending parent';
  end if;

  if exists (
    select 1 from attestations
    where evidence ->> 'supersedesAttestationId' = p_parent_id
  ) then
    return;
  end if;

  return query
  insert into attestations (
    id, type, subject_kind, subject_id, payment_code, order_ref, status,
    reason_code, reason, evidence, signed_at, signature, prev_hash, hash
  )
  values (
    p_attestation ->> 'id',
    p_attestation ->> 'type',
    parent.subject_kind,
    parent.subject_id,
    p_attestation -> 'evidence' ->> 'transactionCode',
    p_attestation -> 'evidence' ->> 'orderRef',
    p_attestation ->> 'status',
    p_attestation ->> 'reasonCode',
    p_attestation ->> 'reason',
    p_attestation -> 'evidence',
    (p_attestation ->> 'signedAt')::timestamptz,
    p_attestation ->> 'signature',
    p_attestation ->> 'prevHash',
    p_attestation ->> 'hash'
  )
  returning *;
end;
$$;

revoke all on function append_attestation_completion(text, jsonb) from public, anon, authenticated;
grant execute on function append_attestation_completion(text, jsonb) to service_role;
