begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_key text not null unique check (tenant_key ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  lifecycle_state text not null default 'pilot' check (lifecycle_state in ('pilot', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id)
);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role text not null default 'member' check (membership_role in ('admin', 'member', 'viewer')),
  membership_state text not null default 'active' check (membership_state in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  device_public_key bytea not null check (octet_length(device_public_key) between 32 and 4096),
  key_algorithm text not null check (key_algorithm in ('ed25519', 'p256')),
  device_state text not null default 'active' check (device_state in ('active', 'revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (id, tenant_id, user_id),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete cascade
);

create table public.google_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  provider_subject_hash bytea not null check (octet_length(provider_subject_hash) = 32),
  account_email_hash bytea check (account_email_hash is null or octet_length(account_email_hash) = 32),
  granted_scopes text[] not null default array[
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly'
  ]::text[],
  connection_state text not null default 'pending' check (connection_state in ('pending', 'active', 'reauthorization_required', 'revoked')),
  encrypted_access_token bytea,
  encrypted_refresh_token bytea,
  token_nonce bytea,
  token_key_version smallint,
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id, user_id),
  unique (tenant_id, user_id, provider_subject_hash),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  check (
    cardinality(granted_scopes) = 2
    and granted_scopes @> array[
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly'
    ]::text[]
    and granted_scopes <@ array[
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly'
    ]::text[]
  ),
  check (
    (encrypted_access_token is null and encrypted_refresh_token is null and token_nonce is null and token_key_version is null)
    or
    ((encrypted_access_token is not null or encrypted_refresh_token is not null)
      and token_nonce is not null and octet_length(token_nonce) >= 12 and token_key_version is not null)
  )
);

create table public.sync_cursors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  connection_id uuid not null,
  resource_kind text not null check (resource_kind in ('calendar', 'contacts', 'drive', 'gmail_metadata')),
  encrypted_cursor bytea not null check (octet_length(encrypted_cursor) > 0),
  cursor_nonce bytea not null check (octet_length(cursor_nonce) >= 12),
  cursor_key_version smallint not null check (cursor_key_version > 0),
  high_watermark_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, connection_id, resource_kind),
  foreign key (connection_id, tenant_id, user_id)
    references public.google_oauth_connections(id, tenant_id, user_id) on delete cascade
);

create table public.relationship_graph_metadata (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  source_subject_hmac bytea not null check (octet_length(source_subject_hmac) = 32),
  source_subject_hmac_key_version smallint not null check (source_subject_hmac_key_version > 0),
  target_subject_hmac bytea not null check (octet_length(target_subject_hmac) = 32),
  target_subject_hmac_key_version smallint not null check (target_subject_hmac_key_version > 0),
  relationship_kind text not null check (relationship_kind in ('direct', 'group_peer', 'workspace_peer', 'unknown')),
  interaction_count bigint not null default 0 check (interaction_count >= 0),
  reciprocity_ratio numeric(5,4) check (reciprocity_ratio between 0 and 1),
  relationship_strength numeric(5,4) check (relationship_strength between 0 and 1),
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  schema_version smallint not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    tenant_id, user_id,
    source_subject_hmac_key_version, source_subject_hmac,
    target_subject_hmac_key_version, target_subject_hmac
  ),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  check (first_observed_at is null or last_observed_at is null or first_observed_at <= last_observed_at)
);

create table public.behavioral_fingerprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null default auth.uid(),
  subject_hash bytea not null check (octet_length(subject_hash) = 32),
  subject_hmac_key_version smallint not null default 1 check (subject_hmac_key_version > 0),
  sample_started_at timestamptz not null,
  sample_ended_at timestamptz not null,
  observation_count integer not null check (observation_count between 1 and 1000000),
  reply_delay_p50_ms integer check (reply_delay_p50_ms between 0 and 604800000),
  reply_delay_p90_ms integer check (reply_delay_p90_ms between 0 and 604800000),
  question_rate numeric(5,4) check (question_rate between 0 and 1),
  emoji_rate numeric(5,4) check (emoji_rate between 0 and 1),
  brevity_score numeric(5,4) check (brevity_score between 0 and 1),
  initiation_rate numeric(5,4) check (initiation_rate between 0 and 1),
  schema_version smallint not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  check (sample_started_at <= sample_ended_at)
);

create table public.pwa_preferences (
  tenant_id uuid not null,
  user_id uuid not null,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  locale_code text not null default 'en' check (locale_code ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  notification_state text not null default 'prompt' check (notification_state in ('prompt', 'enabled', 'disabled')),
  offline_cache_enabled boolean not null default false,
  install_prompt_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete cascade
);

create table public.auto_send_policy_layers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null default auth.uid(),
  layer_kind text not null check (layer_kind in ('tenant', 'relationship', 'chat')),
  relationship_subject_hmac bytea check (
    relationship_subject_hmac is null or octet_length(relationship_subject_hmac) = 32
  ),
  relationship_subject_hmac_key_version smallint check (
    relationship_subject_hmac_key_version is null or relationship_subject_hmac_key_version > 0
  ),
  chat_subject_hmac bytea check (
    chat_subject_hmac is null or octet_length(chat_subject_hmac) = 32
  ),
  chat_subject_hmac_key_version smallint check (
    chat_subject_hmac_key_version is null or chat_subject_hmac_key_version > 0
  ),
  mode text not null default 'never' check (mode in ('never', 'draft', 'countdown', 'safe', 'custom')),
  allow_groups boolean not null default false,
  human_approval_required boolean not null default true,
  minimum_confidence numeric(5,4) not null default 1 check (minimum_confidence between 0 and 1),
  maximum_daily_sends integer not null default 0 check (maximum_daily_sends between 0 and 10000),
  execution_authorized boolean not null default false check (execution_authorized = false),
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, user_id)
    references public.tenant_memberships(tenant_id, user_id) on delete cascade,
  check (
    (layer_kind = 'tenant'
      and relationship_subject_hmac is null
      and relationship_subject_hmac_key_version is null
      and chat_subject_hmac is null
      and chat_subject_hmac_key_version is null)
    or (layer_kind = 'relationship'
      and relationship_subject_hmac is not null
      and relationship_subject_hmac_key_version is not null
      and chat_subject_hmac is null
      and chat_subject_hmac_key_version is null)
    or (layer_kind = 'chat'
      and relationship_subject_hmac is null
      and relationship_subject_hmac_key_version is null
      and chat_subject_hmac is not null
      and chat_subject_hmac_key_version is not null)
  ),
  check (updated_by = user_id)
);

create unique index auto_send_tenant_layer_unique
  on public.auto_send_policy_layers(tenant_id, user_id) where layer_kind = 'tenant';
create unique index auto_send_relationship_layer_unique
  on public.auto_send_policy_layers(
    tenant_id, user_id, relationship_subject_hmac_key_version, relationship_subject_hmac
  ) where layer_kind = 'relationship';
create unique index auto_send_chat_layer_unique
  on public.auto_send_policy_layers(
    tenant_id, user_id, chat_subject_hmac_key_version, chat_subject_hmac
  ) where layer_kind = 'chat';

comment on column public.relationship_graph_metadata.source_subject_hmac is
  'HMAC-SHA-256 over a domain-separated canonical subject identifier using a tenant-specific key; never a raw identifier or plain hash.';
comment on column public.relationship_graph_metadata.target_subject_hmac is
  'HMAC-SHA-256 over a domain-separated canonical subject identifier using a tenant-specific key; never a raw identifier or plain hash.';
comment on column public.behavioral_fingerprints.subject_hash is
  'HMAC-SHA-256 over behavioral-subject-v1 || canonical subject identifier using a tenant-specific key; never a raw identifier or plain hash.';
comment on column public.behavioral_fingerprints.subject_hmac_key_version is
  'Tenant HMAC key version used for subject_hash. Version 1 is the closed-pilot ingress default; rotation requires an audited ingress contract change.';
comment on column public.auto_send_policy_layers.relationship_subject_hmac is
  'Tenant-keyed HMAC-SHA-256 relationship subject ID; raw contact identifiers are forbidden.';
comment on column public.auto_send_policy_layers.chat_subject_hmac is
  'Tenant-keyed HMAC-SHA-256 chat subject ID; raw chat identifiers are forbidden.';
comment on column public.auto_send_policy_layers.execution_authorized is
  'Hard closed-pilot execution lock. This migration permits configuration storage only and cannot authorize sending.';

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  event_kind text not null check (event_kind in (
    'tenant_created', 'membership_changed', 'device_registered', 'device_revoked',
    'oauth_connected', 'oauth_revoked', 'sync_advanced', 'preference_changed',
    'auto_send_policy_changed', 'fingerprint_updated'
  )),
  target_kind text not null check (target_kind in (
    'tenant', 'membership', 'device', 'oauth_connection', 'sync_cursor',
    'relationship_graph', 'behavioral_fingerprint', 'pwa_preference', 'auto_send_policy'
  )),
  target_id uuid,
  outcome text not null check (outcome in ('accepted', 'rejected', 'failed')),
  correlation_id uuid,
  state_fingerprint bytea check (state_fingerprint is null or octet_length(state_fingerprint) = 32),
  occurred_at timestamptz not null default now()
);

create index tenant_memberships_user_idx on public.tenant_memberships(user_id, tenant_id);
create index devices_tenant_user_idx on public.devices(tenant_id, user_id);
create index google_oauth_connections_tenant_user_idx on public.google_oauth_connections(tenant_id, user_id);
create index relationship_graph_tenant_user_idx on public.relationship_graph_metadata(tenant_id, user_id);
create index behavioral_fingerprints_tenant_user_idx on public.behavioral_fingerprints(tenant_id, user_id);
create index audit_events_tenant_time_idx on public.audit_events(tenant_id, occurred_at desc);

create or replace function app_private.is_tenant_owner(p_tenant_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_user_id = auth.uid() and exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id
      and t.owner_user_id = p_user_id
      and t.lifecycle_state = 'pilot'
  );
$$;

create or replace function app_private.is_tenant_member(p_tenant_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_user_id = auth.uid() and (
    app_private.is_tenant_owner(p_tenant_id, p_user_id)
    or exists (
      select 1
      from public.tenant_memberships m
      join public.tenants t on t.id = m.tenant_id
      where m.tenant_id = p_tenant_id
        and m.user_id = p_user_id
        and m.membership_state = 'active'
        and t.lifecycle_state = 'pilot'
    )
  );
$$;

create or replace function app_private.owns_device(p_tenant_id uuid, p_device_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_user_id = auth.uid() and exists (
    select 1 from public.devices d
    where d.id = p_device_id
      and d.tenant_id = p_tenant_id
      and d.user_id = p_user_id
      and d.device_state = 'active'
      and app_private.is_tenant_member(p_tenant_id, p_user_id)
  );
$$;

create or replace function app_private.manage_auto_send_layer(
  p_tenant_id uuid,
  p_policy_user_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_policy_user_id = p_user_id
    and app_private.is_tenant_member(p_tenant_id, p_user_id);
$$;

create or replace function app_private.seed_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_memberships (tenant_id, user_id, membership_role, membership_state, created_by)
  values (new.id, new.owner_user_id, 'admin', 'active', new.owner_user_id)
  on conflict (tenant_id, user_id) do update
    set membership_role = 'admin', membership_state = 'active', updated_at = now();
  return new;
end;
$$;

create or replace function app_private.protect_tenant_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id <> old.owner_user_id then
    raise exception 'tenant ownership transfer requires a privileged, audited operation';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_membership_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'tenant membership provenance is immutable';
  end if;
  return new;
end;
$$;

create trigger tenants_seed_owner_membership
after insert on public.tenants
for each row execute function app_private.seed_owner_membership();

create trigger tenants_protect_owner
before update on public.tenants
for each row execute function app_private.protect_tenant_owner();

create trigger tenant_memberships_protect_provenance
before update on public.tenant_memberships
for each row execute function app_private.protect_membership_provenance();

revoke all on function app_private.is_tenant_owner(uuid, uuid) from public;
revoke all on function app_private.is_tenant_member(uuid, uuid) from public;
revoke all on function app_private.owns_device(uuid, uuid, uuid) from public;
revoke all on function app_private.manage_auto_send_layer(uuid, uuid, uuid) from public;
revoke all on function app_private.seed_owner_membership() from public;
revoke all on function app_private.protect_tenant_owner() from public;
revoke all on function app_private.protect_membership_provenance() from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_tenant_owner(uuid, uuid) to authenticated;
grant execute on function app_private.is_tenant_member(uuid, uuid) to authenticated;
grant execute on function app_private.owns_device(uuid, uuid, uuid) to authenticated;
grant execute on function app_private.manage_auto_send_layer(uuid, uuid, uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_memberships force row level security;
alter table public.devices enable row level security;
alter table public.devices force row level security;
alter table public.google_oauth_connections enable row level security;
alter table public.google_oauth_connections force row level security;
alter table public.sync_cursors enable row level security;
alter table public.sync_cursors force row level security;
alter table public.relationship_graph_metadata enable row level security;
alter table public.relationship_graph_metadata force row level security;
alter table public.behavioral_fingerprints enable row level security;
alter table public.behavioral_fingerprints force row level security;
alter table public.pwa_preferences enable row level security;
alter table public.pwa_preferences force row level security;
alter table public.auto_send_policy_layers enable row level security;
alter table public.auto_send_policy_layers force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy tenants_select_member on public.tenants for select to authenticated
  using (app_private.is_tenant_member(id, auth.uid()));
create policy tenants_insert_owner on public.tenants for insert to authenticated
  with check (auth.uid() is not null and owner_user_id = auth.uid() and lifecycle_state = 'pilot');
create policy tenants_update_owner on public.tenants for update to authenticated
  using (app_private.is_tenant_owner(id, auth.uid()))
  with check (app_private.is_tenant_owner(id, auth.uid()) and owner_user_id = auth.uid() and lifecycle_state = 'pilot');
create policy tenants_delete_owner on public.tenants for delete to authenticated
  using (app_private.is_tenant_owner(id, auth.uid()));

create policy memberships_select_self_or_owner on public.tenant_memberships for select to authenticated
  using (user_id = auth.uid() or app_private.is_tenant_owner(tenant_id, auth.uid()));
create policy memberships_insert_owner on public.tenant_memberships for insert to authenticated
  with check (app_private.is_tenant_owner(tenant_id, auth.uid()) and created_by = auth.uid());
create policy memberships_update_owner on public.tenant_memberships for update to authenticated
  using (app_private.is_tenant_owner(tenant_id, auth.uid()))
  with check (app_private.is_tenant_owner(tenant_id, auth.uid()));
create policy memberships_delete_owner on public.tenant_memberships for delete to authenticated
  using (app_private.is_tenant_owner(tenant_id, auth.uid()) and user_id <> auth.uid());

create policy devices_select_owner_or_self on public.devices for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid())
    and (user_id = auth.uid() or app_private.is_tenant_owner(tenant_id, auth.uid())));
create policy devices_insert_self on public.devices for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy devices_update_owner_or_self on public.devices for update to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid())
    and (user_id = auth.uid() or app_private.is_tenant_owner(tenant_id, auth.uid())))
  with check (app_private.is_tenant_member(tenant_id, auth.uid())
    and (user_id = auth.uid() or app_private.is_tenant_owner(tenant_id, auth.uid())));
create policy devices_delete_owner_or_self on public.devices for delete to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid())
    and (user_id = auth.uid() or app_private.is_tenant_owner(tenant_id, auth.uid())));

create policy google_oauth_select_self on public.google_oauth_connections for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy google_oauth_insert_self on public.google_oauth_connections for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy google_oauth_update_self on public.google_oauth_connections for update to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid())
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy google_oauth_delete_self on public.google_oauth_connections for delete to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());

create policy sync_cursors_select_self on public.sync_cursors for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy sync_cursors_insert_self on public.sync_cursors for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy sync_cursors_update_self on public.sync_cursors for update to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid())
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy sync_cursors_delete_self on public.sync_cursors for delete to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());

create policy relationship_graph_select_self on public.relationship_graph_metadata for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy relationship_graph_insert_self on public.relationship_graph_metadata for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy relationship_graph_update_self on public.relationship_graph_metadata for update to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid())
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy relationship_graph_delete_self on public.relationship_graph_metadata for delete to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());

create policy behavioral_fingerprints_select_self on public.behavioral_fingerprints for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy behavioral_fingerprints_insert_self on public.behavioral_fingerprints for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy behavioral_fingerprints_update_self on public.behavioral_fingerprints for update to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid())
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy behavioral_fingerprints_delete_self on public.behavioral_fingerprints for delete to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());

create policy pwa_preferences_select_self on public.pwa_preferences for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy pwa_preferences_insert_self on public.pwa_preferences for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy pwa_preferences_update_self on public.pwa_preferences for update to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid())
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());
create policy pwa_preferences_delete_self on public.pwa_preferences for delete to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid()) and user_id = auth.uid());

create policy auto_send_select_self on public.auto_send_policy_layers for select to authenticated
  using (app_private.manage_auto_send_layer(tenant_id, user_id, auth.uid()));
create policy auto_send_insert_self on public.auto_send_policy_layers for insert to authenticated
  with check (updated_by = auth.uid()
    and app_private.manage_auto_send_layer(tenant_id, user_id, auth.uid()));
create policy auto_send_update_self on public.auto_send_policy_layers for update to authenticated
  using (app_private.manage_auto_send_layer(tenant_id, user_id, auth.uid()))
  with check (updated_by = auth.uid()
    and app_private.manage_auto_send_layer(tenant_id, user_id, auth.uid()));
create policy auto_send_delete_self on public.auto_send_policy_layers for delete to authenticated
  using (app_private.manage_auto_send_layer(tenant_id, user_id, auth.uid()));

create policy audit_events_select_owner_or_actor on public.audit_events for select to authenticated
  using (app_private.is_tenant_member(tenant_id, auth.uid())
    and (actor_user_id = auth.uid() or app_private.is_tenant_owner(tenant_id, auth.uid())));
create policy audit_events_insert_actor on public.audit_events for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id, auth.uid()) and actor_user_id = auth.uid());

revoke all on public.tenants from anon, authenticated;
revoke all on public.tenant_memberships from anon, authenticated;
revoke all on public.devices from anon, authenticated;
revoke all on public.google_oauth_connections from anon, authenticated;
revoke all on public.sync_cursors from anon, authenticated;
revoke all on public.relationship_graph_metadata from anon, authenticated;
revoke all on public.behavioral_fingerprints from anon, authenticated;
revoke all on public.pwa_preferences from anon, authenticated;
revoke all on public.auto_send_policy_layers from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;
grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.tenant_memberships to authenticated;
grant select, insert, update, delete on public.devices to authenticated;
grant select, insert, update, delete on public.google_oauth_connections to authenticated;
grant select, insert, update, delete on public.sync_cursors to authenticated;
grant select, insert, update, delete on public.relationship_graph_metadata to authenticated;
grant select, insert, update, delete on public.behavioral_fingerprints to authenticated;
grant select, insert, update, delete on public.pwa_preferences to authenticated;
grant select, insert, update, delete on public.auto_send_policy_layers to authenticated;
grant select, insert on public.audit_events to authenticated;

commit;
