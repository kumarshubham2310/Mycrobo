begin;

-- This migration creates only the tenant-bound, ciphertext-only relay data
-- plane. It does not expose a public connector, synchronize chats, draft a
-- reply or authorize message delivery.

alter table public.devices
  add column if not exists device_kind text not null default 'desktop_connector'
    check (device_kind in ('desktop_connector', 'web_client'));

create table public.relay_pairing_challenges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  desktop_device_id uuid not null,
  web_device_id uuid not null,
  challenge_digest bytea not null check (octet_length(challenge_digest) = 32),
  session_binding_digest bytea not null check (octet_length(session_binding_digest) = 32),
  pairing_state text not null default 'pending'
    check (pairing_state in ('pending', 'consumed', 'revoked', 'expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id, user_id),
  foreign key (tenant_id, user_id)
    references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  foreign key (desktop_device_id, tenant_id, user_id)
    references public.devices(id, tenant_id, user_id) on delete cascade,
  foreign key (web_device_id, tenant_id, user_id)
    references public.devices(id, tenant_id, user_id) on delete cascade,
  check (desktop_device_id <> web_device_id),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (
    (pairing_state = 'consumed' and consumed_at is not null and consumed_at <= expires_at)
    or (pairing_state <> 'consumed' and consumed_at is null)
  )
);

create table public.relay_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  pairing_challenge_id uuid not null,
  desktop_device_id uuid not null,
  web_device_id uuid not null,
  session_binding_digest bytea not null check (octet_length(session_binding_digest) = 32),
  key_epoch smallint not null default 1 check (key_epoch between 1 and 32767),
  capabilities text[] not null default array['connection_status']::text[],
  session_state text not null default 'active'
    check (session_state in ('active', 'revoked', 'expired')),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id, user_id),
  unique (pairing_challenge_id),
  foreign key (pairing_challenge_id, tenant_id, user_id)
    references public.relay_pairing_challenges(id, tenant_id, user_id) on delete cascade,
  foreign key (desktop_device_id, tenant_id, user_id)
    references public.devices(id, tenant_id, user_id) on delete cascade,
  foreign key (web_device_id, tenant_id, user_id)
    references public.devices(id, tenant_id, user_id) on delete cascade,
  check (desktop_device_id <> web_device_id),
  check (
    cardinality(capabilities) between 1 and 3
    and capabilities <@ array['connection_status', 'chat_read', 'draft_request']::text[]
  ),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check (
    (session_state = 'revoked' and revoked_at is not null)
    or (session_state <> 'revoked' and revoked_at is null)
  )
);

create table public.relay_envelopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  session_id uuid not null,
  sender_device_id uuid not null,
  recipient_device_id uuid not null,
  sequence_number bigint not null check (sequence_number > 0),
  key_epoch smallint not null check (key_epoch between 1 and 32767),
  capability text not null check (capability in ('connection_status', 'chat_read', 'draft_request')),
  relationship_subject_hmac bytea check (
    relationship_subject_hmac is null or octet_length(relationship_subject_hmac) = 32
  ),
  chat_subject_hmac bytea check (
    chat_subject_hmac is null or octet_length(chat_subject_hmac) = 32
  ),
  nonce bytea not null check (octet_length(nonce) = 12),
  aad_digest bytea not null check (octet_length(aad_digest) = 32),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 524304),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, sender_device_id, sequence_number),
  foreign key (session_id, tenant_id, user_id)
    references public.relay_sessions(id, tenant_id, user_id) on delete cascade,
  foreign key (sender_device_id, tenant_id, user_id)
    references public.devices(id, tenant_id, user_id) on delete cascade,
  foreign key (recipient_device_id, tenant_id, user_id)
    references public.devices(id, tenant_id, user_id) on delete cascade,
  check (sender_device_id <> recipient_device_id),
  check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  check (
    (capability = 'connection_status'
      and relationship_subject_hmac is null
      and chat_subject_hmac is null)
    or (capability in ('chat_read', 'draft_request')
      and relationship_subject_hmac is not null
      and chat_subject_hmac is not null)
  )
);

create table public.relay_security_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null default auth.uid(),
  session_id uuid,
  event_kind text not null check (event_kind in (
    'pairing_created', 'pairing_consumed', 'pairing_rejected',
    'session_created', 'session_revoked', 'envelope_rejected'
  )),
  outcome text not null check (outcome in ('accepted', 'rejected', 'failed')),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z0-9_]{1,64}$'),
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, user_id)
    references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  foreign key (session_id, tenant_id, user_id)
    references public.relay_sessions(id, tenant_id, user_id) on delete restrict
);

create index relay_pairing_user_expiry_idx
  on public.relay_pairing_challenges(tenant_id, user_id, expires_at desc);
create index relay_sessions_user_state_idx
  on public.relay_sessions(tenant_id, user_id, session_state, expires_at desc);
create index relay_envelopes_recipient_idx
  on public.relay_envelopes(tenant_id, user_id, recipient_device_id, created_at);
create index relay_security_events_user_time_idx
  on public.relay_security_events(tenant_id, user_id, occurred_at desc);

comment on table public.relay_envelopes is
  'Short-lived end-to-end encrypted relay envelopes. The service stores ciphertext only and has no delivery capability.';
comment on column public.relay_envelopes.relationship_subject_hmac is
  'Tenant-keyed relationship HMAC included in authenticated additional data; never a raw contact identifier.';
comment on column public.relay_envelopes.chat_subject_hmac is
  'Tenant-keyed chat HMAC included in authenticated additional data; never a raw chat identifier.';

create or replace function app_private.owns_relay_device_pair(
  p_tenant_id uuid,
  p_desktop_device_id uuid,
  p_web_device_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and p_desktop_device_id <> p_web_device_id
    and app_private.is_tenant_member(p_tenant_id, p_user_id)
    and exists (
      select 1
        from public.devices desktop_device
        join public.devices web_device
          on web_device.tenant_id = desktop_device.tenant_id
         and web_device.user_id = desktop_device.user_id
       where desktop_device.id = p_desktop_device_id
         and desktop_device.tenant_id = p_tenant_id
         and desktop_device.user_id = p_user_id
         and desktop_device.device_kind = 'desktop_connector'
         and desktop_device.device_state = 'active'
         and web_device.id = p_web_device_id
         and web_device.device_kind = 'web_client'
         and web_device.device_state = 'active'
    );
$$;

create or replace function app_private.owns_relay_session(
  p_tenant_id uuid,
  p_session_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and app_private.is_tenant_member(p_tenant_id, p_user_id)
    and exists (
      select 1
        from public.relay_sessions session
       where session.id = p_session_id
         and session.tenant_id = p_tenant_id
         and session.user_id = p_user_id
    );
$$;

create or replace function app_private.relay_session_creation_allowed(
  p_tenant_id uuid,
  p_pairing_challenge_id uuid,
  p_desktop_device_id uuid,
  p_web_device_id uuid,
  p_session_binding_digest bytea,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and app_private.owns_relay_device_pair(
      p_tenant_id, p_desktop_device_id, p_web_device_id, p_user_id
    )
    and exists (
      select 1
        from public.relay_pairing_challenges pairing
       where pairing.id = p_pairing_challenge_id
         and pairing.tenant_id = p_tenant_id
         and pairing.user_id = p_user_id
         and pairing.desktop_device_id = p_desktop_device_id
         and pairing.web_device_id = p_web_device_id
         and pairing.session_binding_digest = p_session_binding_digest
         and pairing.pairing_state = 'consumed'
         and pairing.consumed_at is not null
         and pairing.expires_at > pairing.consumed_at
    );
$$;

create or replace function app_private.relay_envelope_allowed(
  p_tenant_id uuid,
  p_session_id uuid,
  p_sender_device_id uuid,
  p_recipient_device_id uuid,
  p_capability text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1
        from public.relay_sessions session
       where session.id = p_session_id
         and session.tenant_id = p_tenant_id
         and session.user_id = p_user_id
         and session.session_state = 'active'
         and session.expires_at > now()
         and p_capability = any(session.capabilities)
         and (
           (session.desktop_device_id = p_sender_device_id and session.web_device_id = p_recipient_device_id)
           or (session.web_device_id = p_sender_device_id and session.desktop_device_id = p_recipient_device_id)
         )
    );
$$;

create or replace function app_private.protect_relay_pairing_challenge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.tenant_id, old.user_id, old.desktop_device_id, old.web_device_id,
         old.challenge_digest, old.session_binding_digest, old.expires_at, old.created_at)
     is distinct from
     row(new.id, new.tenant_id, new.user_id, new.desktop_device_id, new.web_device_id,
         new.challenge_digest, new.session_binding_digest, new.expires_at, new.created_at) then
    raise exception 'relay pairing identity and cryptographic binding are immutable';
  end if;
  if old.pairing_state <> 'pending' and new.pairing_state <> old.pairing_state then
    raise exception 'terminal relay pairing state is immutable';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_relay_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.tenant_id, old.user_id, old.pairing_challenge_id,
         old.desktop_device_id, old.web_device_id, old.session_binding_digest,
         old.key_epoch, old.capabilities, old.expires_at, old.created_at)
     is distinct from
     row(new.id, new.tenant_id, new.user_id, new.pairing_challenge_id,
         new.desktop_device_id, new.web_device_id, new.session_binding_digest,
         new.key_epoch, new.capabilities, new.expires_at, new.created_at) then
    raise exception 'relay session identity, capabilities and cryptographic binding are immutable';
  end if;
  if old.session_state <> 'active' and new.session_state <> old.session_state then
    raise exception 'terminal relay session state is immutable';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_relay_envelope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.tenant_id, old.user_id, old.session_id, old.sender_device_id,
         old.recipient_device_id, old.sequence_number, old.key_epoch, old.capability,
         old.relationship_subject_hmac, old.chat_subject_hmac, old.nonce,
         old.aad_digest, old.ciphertext, old.expires_at, old.created_at)
     is distinct from
     row(new.id, new.tenant_id, new.user_id, new.session_id, new.sender_device_id,
         new.recipient_device_id, new.sequence_number, new.key_epoch, new.capability,
         new.relationship_subject_hmac, new.chat_subject_hmac, new.nonce,
         new.aad_digest, new.ciphertext, new.expires_at, new.created_at) then
    raise exception 'relay envelope authenticated fields are immutable';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'consumed relay envelope state is immutable';
  end if;
  return new;
end;
$$;

create trigger relay_pairing_protect_binding
before update on public.relay_pairing_challenges
for each row execute function app_private.protect_relay_pairing_challenge();
create trigger relay_sessions_protect_binding
before update on public.relay_sessions
for each row execute function app_private.protect_relay_session();
create trigger relay_envelopes_protect_binding
before update on public.relay_envelopes
for each row execute function app_private.protect_relay_envelope();

revoke all on function app_private.owns_relay_device_pair(uuid, uuid, uuid, uuid) from public;
revoke all on function app_private.owns_relay_session(uuid, uuid, uuid) from public;
revoke all on function app_private.relay_session_creation_allowed(uuid, uuid, uuid, uuid, bytea, uuid) from public;
revoke all on function app_private.relay_envelope_allowed(uuid, uuid, uuid, uuid, text, uuid) from public;
revoke all on function app_private.protect_relay_pairing_challenge() from public;
revoke all on function app_private.protect_relay_session() from public;
revoke all on function app_private.protect_relay_envelope() from public;
grant execute on function app_private.owns_relay_device_pair(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function app_private.owns_relay_session(uuid, uuid, uuid) to authenticated;
grant execute on function app_private.relay_session_creation_allowed(uuid, uuid, uuid, uuid, bytea, uuid) to authenticated;
grant execute on function app_private.relay_envelope_allowed(uuid, uuid, uuid, uuid, text, uuid) to authenticated;

alter table public.relay_pairing_challenges enable row level security;
alter table public.relay_pairing_challenges force row level security;
alter table public.relay_sessions enable row level security;
alter table public.relay_sessions force row level security;
alter table public.relay_envelopes enable row level security;
alter table public.relay_envelopes force row level security;
alter table public.relay_security_events enable row level security;
alter table public.relay_security_events force row level security;

create policy relay_pairing_select_self on public.relay_pairing_challenges for select to authenticated
  using (user_id = auth.uid() and app_private.is_tenant_member(tenant_id, auth.uid()));
create policy relay_pairing_insert_self on public.relay_pairing_challenges for insert to authenticated
  with check (user_id = auth.uid()
    and pairing_state = 'pending'
    and expires_at > now()
    and app_private.owns_relay_device_pair(tenant_id, desktop_device_id, web_device_id, auth.uid()));
create policy relay_pairing_update_self on public.relay_pairing_challenges for update to authenticated
  using (user_id = auth.uid() and app_private.is_tenant_member(tenant_id, auth.uid()))
  with check (user_id = auth.uid() and app_private.is_tenant_member(tenant_id, auth.uid()));

create policy relay_sessions_select_self on public.relay_sessions for select to authenticated
  using (user_id = auth.uid() and app_private.is_tenant_member(tenant_id, auth.uid()));
create policy relay_sessions_insert_self on public.relay_sessions for insert to authenticated
  with check (user_id = auth.uid()
    and session_state = 'active'
    and expires_at > now()
    and app_private.relay_session_creation_allowed(
      tenant_id, pairing_challenge_id, desktop_device_id, web_device_id,
      session_binding_digest, auth.uid()
    ));
create policy relay_sessions_update_self on public.relay_sessions for update to authenticated
  using (user_id = auth.uid() and app_private.owns_relay_session(tenant_id, id, auth.uid()))
  with check (user_id = auth.uid() and app_private.owns_relay_session(tenant_id, id, auth.uid()));

create policy relay_envelopes_select_self on public.relay_envelopes for select to authenticated
  using (user_id = auth.uid()
    and expires_at > now()
    and app_private.relay_envelope_allowed(
      tenant_id, session_id, sender_device_id, recipient_device_id, capability, auth.uid()
    ));
create policy relay_envelopes_insert_self on public.relay_envelopes for insert to authenticated
  with check (user_id = auth.uid()
    and consumed_at is null
    and expires_at > now()
    and app_private.relay_envelope_allowed(
      tenant_id, session_id, sender_device_id, recipient_device_id, capability, auth.uid()
    ));
create policy relay_envelopes_update_self on public.relay_envelopes for update to authenticated
  using (user_id = auth.uid()
    and app_private.relay_envelope_allowed(
      tenant_id, session_id, sender_device_id, recipient_device_id, capability, auth.uid()
    ))
  with check (user_id = auth.uid()
    and app_private.relay_envelope_allowed(
      tenant_id, session_id, sender_device_id, recipient_device_id, capability, auth.uid()
    ));

create policy relay_security_events_select_self on public.relay_security_events for select to authenticated
  using (user_id = auth.uid() and app_private.is_tenant_member(tenant_id, auth.uid()));
create policy relay_security_events_insert_self on public.relay_security_events for insert to authenticated
  with check (user_id = auth.uid() and app_private.is_tenant_member(tenant_id, auth.uid()));

revoke all on public.relay_pairing_challenges from anon, authenticated;
revoke all on public.relay_sessions from anon, authenticated;
revoke all on public.relay_envelopes from anon, authenticated;
revoke all on public.relay_security_events from anon, authenticated;
grant select, insert, update on public.relay_pairing_challenges to authenticated;
grant select, insert, update on public.relay_sessions to authenticated;
grant select, insert, update on public.relay_envelopes to authenticated;
grant select, insert on public.relay_security_events to authenticated;

commit;
