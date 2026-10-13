-- TEST-ONLY OPERATOR FIXTURE. NEVER APPLY TO A PROJECT CONTAINING CUSTOMER DATA.
-- This file is intentionally outside migrations: it must be reviewed, have all four
-- placeholders replaced, and be applied manually to the dedicated verification project.
-- It creates two synthetic tenant graphs with one bounded row in every migrated
-- tenant-owned table. The verifier needs these rows to prove both positive
-- visibility and negative cross-tenant visibility for the complete schema.
-- It does not change policies, assign privileges, remove data, or weaken RLS.

begin;

do $fixture$
declare
  principal_a uuid := '__PRINCIPAL_A_UUID__';
  principal_b uuid := '__PRINCIPAL_B_UUID__';
  tenant_a uuid := '__TENANT_A_UUID__';
  tenant_b uuid := '__TENANT_B_UUID__';
  connection_a uuid := gen_random_uuid();
  connection_b uuid := gen_random_uuid();
  desktop_device_a uuid := gen_random_uuid();
  desktop_device_b uuid := gen_random_uuid();
  web_device_a uuid := gen_random_uuid();
  web_device_b uuid := gen_random_uuid();
  pairing_a uuid := gen_random_uuid();
  pairing_b uuid := gen_random_uuid();
  relay_session_a uuid := gen_random_uuid();
  relay_session_b uuid := gen_random_uuid();
  expected_database_comment constant text := 'mycrobo:closed-pilot-test:v1:no-customer-data';
  actual_database_comment text;
begin
  select shobj_description(d.oid, 'pg_database')
    into actual_database_comment
    from pg_catalog.pg_database d
   where d.datname = current_database();

  if actual_database_comment is distinct from expected_database_comment then
    raise exception 'refusing fixture: database is not explicitly marked as the no-customer-data test project';
  end if;
  if principal_a = principal_b or tenant_a = tenant_b then
    raise exception 'refusing fixture: two distinct principals and tenants are required';
  end if;
  if not exists (
    select 1 from auth.users u
     where u.id = principal_a
       and u.raw_app_meta_data @> jsonb_build_object('mycrobo_verification', true, 'mycrobo_tenant_id', tenant_a::text)
  ) or not exists (
    select 1 from auth.users u
     where u.id = principal_b
       and u.raw_app_meta_data @> jsonb_build_object('mycrobo_verification', true, 'mycrobo_tenant_id', tenant_b::text)
  ) then
    raise exception 'refusing fixture: both test-only Auth users and signed tenant-bound app_metadata must already exist';
  end if;
  if exists (select 1 from public.tenants where id in (tenant_a, tenant_b)) then
    raise exception 'refusing fixture: a selected synthetic tenant UUID already exists';
  end if;

  insert into public.tenants (id, owner_user_id, tenant_key, lifecycle_state)
  values
    (tenant_a, principal_a, 'mycrobo-rls-' || replace(tenant_a::text, '-', ''), 'pilot'),
    (tenant_b, principal_b, 'mycrobo-rls-' || replace(tenant_b::text, '-', ''), 'pilot');

  insert into public.devices (
    id, tenant_id, user_id, device_public_key, key_algorithm, device_state, device_kind
  ) values
    (desktop_device_a, tenant_a, principal_a, decode(repeat('11', 32), 'hex'), 'ed25519', 'active', 'desktop_connector'),
    (web_device_a, tenant_a, principal_a, decode('04' || repeat('13', 64), 'hex'), 'p256', 'active', 'web_client'),
    (desktop_device_b, tenant_b, principal_b, decode(repeat('12', 32), 'hex'), 'ed25519', 'active', 'desktop_connector'),
    (web_device_b, tenant_b, principal_b, decode('04' || repeat('14', 64), 'hex'), 'p256', 'active', 'web_client');

  insert into public.google_oauth_connections (
    id, tenant_id, user_id, provider_subject_hash, connection_state
  ) values
    (connection_a, tenant_a, principal_a, decode(repeat('21', 32), 'hex'), 'pending'),
    (connection_b, tenant_b, principal_b, decode(repeat('22', 32), 'hex'), 'pending');

  insert into public.sync_cursors (
    id, tenant_id, user_id, connection_id, resource_kind,
    encrypted_cursor, cursor_nonce, cursor_key_version
  ) values
    (gen_random_uuid(), tenant_a, principal_a, connection_a, 'gmail_metadata', decode('31', 'hex'), decode(repeat('32', 12), 'hex'), 1),
    (gen_random_uuid(), tenant_b, principal_b, connection_b, 'gmail_metadata', decode('33', 'hex'), decode(repeat('34', 12), 'hex'), 1);

  insert into public.relationship_graph_metadata (
    id, tenant_id, user_id,
    source_subject_hmac, source_subject_hmac_key_version,
    target_subject_hmac, target_subject_hmac_key_version,
    relationship_kind, interaction_count, schema_version
  ) values
    (gen_random_uuid(), tenant_a, principal_a, decode(repeat('41', 32), 'hex'), 1, decode(repeat('42', 32), 'hex'), 1, 'direct', 1, 1),
    (gen_random_uuid(), tenant_b, principal_b, decode(repeat('43', 32), 'hex'), 1, decode(repeat('44', 32), 'hex'), 1, 'direct', 1, 1);

  insert into public.behavioral_fingerprints (
    id, tenant_id, user_id, subject_hash, subject_hmac_key_version,
    sample_started_at, sample_ended_at, observation_count, schema_version
  ) values
    (gen_random_uuid(), tenant_a, principal_a, decode(repeat('51', 32), 'hex'), 1, '2026-10-08T00:00:00Z', '2026-10-08T00:01:00Z', 1, 1),
    (gen_random_uuid(), tenant_b, principal_b, decode(repeat('52', 32), 'hex'), 1, '2026-10-08T00:00:00Z', '2026-10-08T00:01:00Z', 1, 1);

  insert into public.pwa_preferences (
    tenant_id, user_id, theme, locale_code, notification_state, offline_cache_enabled
  ) values
    (tenant_a, principal_a, 'system', 'en', 'disabled', false),
    (tenant_b, principal_b, 'system', 'en', 'disabled', false);

  insert into public.auto_send_policy_layers (
    id, tenant_id, user_id, layer_kind, mode, allow_groups,
    human_approval_required, minimum_confidence, maximum_daily_sends,
    execution_authorized, updated_by
  ) values
    (gen_random_uuid(), tenant_a, principal_a, 'tenant', 'never', false, true, 1, 0, false, principal_a),
    (gen_random_uuid(), tenant_b, principal_b, 'tenant', 'never', false, true, 1, 0, false, principal_b);

  insert into public.relay_pairing_challenges (
    id, tenant_id, user_id, desktop_device_id, web_device_id,
    challenge_digest, session_binding_digest, pairing_state,
    expires_at, consumed_at
  ) values
    (pairing_a, tenant_a, principal_a, desktop_device_a, web_device_a,
      decode(repeat('61', 32), 'hex'), decode(repeat('62', 32), 'hex'), 'consumed',
      now() + interval '10 minutes', now()),
    (pairing_b, tenant_b, principal_b, desktop_device_b, web_device_b,
      decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex'), 'consumed',
      now() + interval '10 minutes', now());

  insert into public.relay_sessions (
    id, tenant_id, user_id, pairing_challenge_id, desktop_device_id,
    web_device_id, session_binding_digest, capabilities, expires_at
  ) values
    (relay_session_a, tenant_a, principal_a, pairing_a, desktop_device_a,
      web_device_a, decode(repeat('62', 32), 'hex'), array['connection_status']::text[], now() + interval '1 day'),
    (relay_session_b, tenant_b, principal_b, pairing_b, desktop_device_b,
      web_device_b, decode(repeat('64', 32), 'hex'), array['connection_status']::text[], now() + interval '1 day');

  insert into public.relay_envelopes (
    id, tenant_id, user_id, session_id, sender_device_id, recipient_device_id,
    sequence_number, key_epoch, capability, nonce, aad_digest, ciphertext, expires_at
  ) values
    (gen_random_uuid(), tenant_a, principal_a, relay_session_a, desktop_device_a, web_device_a,
      1, 1, 'connection_status', decode(repeat('71', 12), 'hex'), decode(repeat('72', 32), 'hex'),
      decode(repeat('73', 17), 'hex'), now() + interval '5 minutes'),
    (gen_random_uuid(), tenant_b, principal_b, relay_session_b, desktop_device_b, web_device_b,
      1, 1, 'connection_status', decode(repeat('74', 12), 'hex'), decode(repeat('75', 32), 'hex'),
      decode(repeat('76', 17), 'hex'), now() + interval '5 minutes');

  insert into public.relay_security_events (
    id, tenant_id, user_id, session_id, event_kind, outcome, reason_code
  ) values
    (gen_random_uuid(), tenant_a, principal_a, relay_session_a, 'session_created', 'accepted', 'synthetic_fixture'),
    (gen_random_uuid(), tenant_b, principal_b, relay_session_b, 'session_created', 'accepted', 'synthetic_fixture');

  insert into public.audit_events (
    id, tenant_id, actor_user_id, event_kind, target_kind, outcome
  ) values
    (gen_random_uuid(), tenant_a, principal_a, 'preference_changed', 'pwa_preference', 'accepted'),
    (gen_random_uuid(), tenant_b, principal_b, 'preference_changed', 'pwa_preference', 'accepted');
end;
$fixture$;

commit;
