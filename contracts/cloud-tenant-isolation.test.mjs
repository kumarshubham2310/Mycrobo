import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateBehaviorFingerprintPayload } from '../infrastructure/cloudflare/src/worker.mjs';

const migrationPath = new URL('../infrastructure/supabase/migrations/202610080001_closed_pilot_tenant_isolation.sql', import.meta.url);
const schemaPath = new URL('../infrastructure/contracts/behavior-fingerprint.schema.json', import.meta.url);
const autoSendSchemaPath = new URL('../infrastructure/contracts/auto-send-policy-layer.schema.json', import.meta.url);
const wranglerPath = new URL('../infrastructure/cloudflare/wrangler.toml.example', import.meta.url);
const fixturePath = new URL('../infrastructure/supabase/verification/closed_pilot_rls_fixture.sql', import.meta.url);
const [migration, schemaText, autoSendSchemaText, wrangler, fixture] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(schemaPath, 'utf8'),
  readFile(autoSendSchemaPath, 'utf8'),
  readFile(wranglerPath, 'utf8'),
  readFile(fixturePath, 'utf8'),
]);

const tenantTables = [
  'tenants',
  'tenant_memberships',
  'devices',
  'google_oauth_connections',
  'sync_cursors',
  'relationship_graph_metadata',
  'behavioral_fingerprints',
  'pwa_preferences',
  'auto_send_policy_layers',
  'audit_events',
];

function tableDefinition(name) {
  const match = migration.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`, 'i'));
  assert.ok(match, `missing table definition for ${name}`);
  return match[1];
}

test('every closed-pilot table enables and forces RLS with auth-bound policies', () => {
  for (const table of tenantTables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security;`, 'i'));
    const policyBlock = [...migration.matchAll(new RegExp(`create policy [^\\n]+ on public\\.${table}([\\s\\S]*?);`, 'gi'))]
      .map((match) => match[0]).join('\n');
    assert.ok(policyBlock, `missing policies for ${table}`);
    assert.match(policyBlock, /auth\.uid\(\)/i, `${table} policies must bind to auth.uid()`);
  }
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /p_user_id is not null and p_user_id = auth\.uid\(\)/i);
  assert.match(migration, /where t\.id = p_tenant_id[\s\S]*?t\.owner_user_id = p_user_id[\s\S]*?t\.lifecycle_state = 'pilot'/i,
    'tenant ownership must fail closed when the tenant is suspended or closed');
  assert.match(migration, /from public\.tenant_memberships m[\s\S]*?join public\.tenants t on t\.id = m\.tenant_id[\s\S]*?m\.membership_state = 'active'[\s\S]*?t\.lifecycle_state = 'pilot'/i,
    'active membership must not authorize a suspended or closed tenant');
  assert.match(migration, /create policy tenants_insert_owner[\s\S]*?lifecycle_state = 'pilot'/i,
    'authenticated users may create only an active pilot tenant');
  assert.match(migration, /create policy tenants_update_owner[\s\S]*?lifecycle_state = 'pilot'/i,
    'tenant owners cannot use the ordinary data plane to suspend, close, or reopen a tenant');
  assert.match(migration, /grant execute on function app_private\.is_tenant_member\(uuid, uuid\) to authenticated;/i);
  assert.match(migration, /create trigger tenant_memberships_protect_provenance[\s\S]*?before update on public\.tenant_memberships[\s\S]*?protect_membership_provenance\(\)/i,
    'tenant membership provenance must be protected before owner-driven updates');
  assert.match(migration, /if new\.created_by is distinct from old\.created_by then[\s\S]*?provenance is immutable/i,
    'created_by must be immutable after membership creation');
  for (const table of ['google_oauth_connections', 'sync_cursors', 'relationship_graph_metadata', 'behavioral_fingerprints', 'pwa_preferences']) {
    const selectPolicy = [...migration.matchAll(new RegExp(`create policy [^\\n]+ on public\\.${table} for select to authenticated([\\s\\S]*?);`, 'gi'))]
      .map((match) => match[0]).join('\n');
    assert.match(selectPolicy, /user_id = auth\.uid\(\)/i, `${table} SELECT must stay user-scoped`);
  }
});

test('operator-applied live-verification fixture stays test-only, bounded, and outside production migration', () => {
  for (const placeholder of ['__PRINCIPAL_A_UUID__', '__PRINCIPAL_B_UUID__', '__TENANT_A_UUID__', '__TENANT_B_UUID__']) {
    assert.match(fixture, new RegExp(placeholder, 'u'), `missing non-runnable fixture placeholder ${placeholder}`);
    assert.doesNotMatch(migration, new RegExp(placeholder, 'u'), 'test fixture leaked into the production migration');
  }
  assert.match(fixture, /mycrobo:closed-pilot-test:v1:no-customer-data/u);
  assert.match(fixture, /raw_app_meta_data[\s\S]*?mycrobo_verification[\s\S]*?mycrobo_tenant_id/u);
  assert.match(migration, /create trigger tenants_seed_owner_membership[\s\S]*?seed_owner_membership\(\)/u,
    'synthetic owners must receive the same trigger-seeded membership as pilot tenants');
  assert.doesNotMatch(fixture, /insert into public\.tenant_memberships/iu,
    'the fixture must not duplicate the migration trigger owner-membership insert');
  for (const table of tenantTables.filter((table) => table !== 'tenant_memberships')) {
    assert.match(fixture, new RegExp(`insert into public\\.${table}`, 'u'),
      `fixture must include bounded positive evidence for ${table}`);
  }
  assert.match(fixture, /connection_a uuid := gen_random_uuid\(\)/u);
  assert.match(fixture, /'mycrobo-rls-' \|\| replace\(tenant_a::text, '-', ''\)/u);
  assert.doesNotMatch(fixture, /'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'/iu,
    'fixture identifiers must come from reviewed placeholders or generated values, not global UUID literals');
  assert.doesNotMatch(fixture, /\b(?:alter|create|delete|drop|grant|revoke|truncate)\b/iu,
    'fixture must not change schema, authorization, or existing data');
});

test('tenant-owned storage has no raw communication fields or tables', () => {
  const forbiddenTable = /create table public\.(?:messages?|chats?|attachments?|drafts?|transcripts?)\b/i;
  const forbiddenColumn = /^\s*(?:raw_)?(?:message|body|content|caption|media|transcript|prompt|draft)(?:_|\s)/im;
  const forbiddenSubjectIdentifier = /^\s*(?:chat|contact|phone|jid)(?:_id|_identifier|_address)\s/im;
  assert.doesNotMatch(migration, forbiddenTable);
  for (const table of tenantTables) {
    const definition = tableDefinition(table);
    assert.doesNotMatch(definition, forbiddenColumn, table);
    assert.doesNotMatch(definition, forbiddenSubjectIdentifier, `${table} must not store raw chat/contact identifiers`);
  }
  const oauth = tableDefinition('google_oauth_connections');
  assert.match(oauth, /encrypted_access_token bytea/i);
  assert.match(oauth, /encrypted_refresh_token bytea/i);
  assert.doesNotMatch(oauth, /^\s*(?:access_token|refresh_token)\s+(?:text|varchar)/im);
});

test('behavior fingerprint contract is closed and content-free', () => {
  const schema = JSON.parse(schemaText);
  assert.equal(schema.additionalProperties, false);
  const names = Object.keys(schema.properties);
  assert.deepEqual(names.sort(), [
    'tenant_id', 'subject_hash', 'sample_started_at', 'sample_ended_at', 'observation_count',
    'reply_delay_p50_ms', 'reply_delay_p90_ms', 'question_rate', 'emoji_rate',
    'brevity_score', 'initiation_rate', 'schema_version',
  ].sort());
  assert.ok(names.every((name) => !/(message|body|content|caption|media|transcript|prompt|draft|payload)/i.test(name)));
  assert.deepEqual(schema['x-subject-identifier'], {
    algorithm: 'HMAC-SHA-256',
    key_scope: 'tenant',
    key_version: 1,
    domain_separator: 'behavioral-subject-v1',
    raw_identifiers_forbidden: true,
  });
  assert.match(schema.properties.subject_hash.description, /tenant key/i);
  const fingerprintTable = tableDefinition('behavioral_fingerprints');
  assert.match(fingerprintTable, /subject_hash bytea not null check \(octet_length\(subject_hash\) = 32\)/i);
  assert.match(fingerprintTable, /subject_hmac_key_version smallint not null default 1 check \(subject_hmac_key_version > 0\)/i);

  const valid = {
    tenant_id: '018f3f2e-f7e7-4e39-8a88-6c4e76829f11',
    subject_hash: 'a'.repeat(64),
    sample_started_at: '2026-10-01T00:00:00.000Z',
    sample_ended_at: '2026-10-02T00:00:00.000Z',
    observation_count: 12,
    reply_delay_p50_ms: 900,
    question_rate: 0.25,
    schema_version: 1,
  };
  assert.equal(validateBehaviorFingerprintPayload(valid), true);
  assert.equal(validateBehaviorFingerprintPayload({ ...valid, content: 'must never pass' }), false);
  assert.equal(validateBehaviorFingerprintPayload({ ...valid, observation_count: 0 }), false);
  assert.equal(validateBehaviorFingerprintPayload({ ...valid, question_rate: 1.01 }), false);
});

test('Google OAuth storage enforces exactly the two approved read-only scopes', () => {
  const oauth = tableDefinition('google_oauth_connections');
  const gmailReadonly = 'https://www.googleapis.com/auth/gmail.readonly';
  const calendarReadonly = 'https://www.googleapis.com/auth/calendar.readonly';
  assert.match(oauth, /cardinality\(granted_scopes\) = 2/i);
  assert.match(oauth, /granted_scopes @> array\[/i);
  assert.match(oauth, /granted_scopes <@ array\[/i);
  assert.equal(oauth.split(gmailReadonly).length - 1, 3);
  assert.equal(oauth.split(calendarReadonly).length - 1, 3);
  assert.doesNotMatch(oauth, /gmail\.(?:modify|compose|send)|auth\/calendar(?:'|\s)/i);
});

test('auto-send stores tenant -> relationship -> chat policy but execution stays locked', () => {
  const autoSend = tableDefinition('auto_send_policy_layers');
  const schema = JSON.parse(autoSendSchemaText);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.layer_kind.enum, ['tenant', 'relationship', 'chat']);
  assert.deepEqual(schema.properties.mode.enum, ['never', 'draft', 'countdown', 'safe', 'custom']);
  assert.equal(schema.properties.execution_authorized.const, false);
  assert.match(schema.$defs.subjectHmac.description, /tenant-keyed HMAC-SHA-256/i);

  assert.match(autoSend, /layer_kind text not null check \(layer_kind in \('tenant', 'relationship', 'chat'\)\)/i);
  assert.match(autoSend, /mode text not null default 'never' check \(mode in \('never', 'draft', 'countdown', 'safe', 'custom'\)\)/i);
  assert.match(autoSend, /relationship_subject_hmac bytea[\s\S]*octet_length\(relationship_subject_hmac\) = 32/i);
  assert.match(autoSend, /relationship_subject_hmac_key_version smallint[\s\S]*relationship_subject_hmac_key_version > 0/i);
  assert.match(autoSend, /chat_subject_hmac bytea[\s\S]*octet_length\(chat_subject_hmac\) = 32/i);
  assert.match(autoSend, /chat_subject_hmac_key_version smallint[\s\S]*chat_subject_hmac_key_version > 0/i);
  assert.match(autoSend, /human_approval_required boolean not null default true/i);
  assert.match(autoSend, /maximum_daily_sends integer not null default 0/i);
  assert.match(autoSend, /execution_authorized boolean not null default false check \(execution_authorized = false\)/i);
  assert.match(autoSend, /foreign key \(tenant_id, user_id\)[\s\S]*tenant_memberships\(tenant_id, user_id\)/i);
  assert.match(autoSend, /check \(updated_by = user_id\)/i);
  assert.doesNotMatch(autoSend, /(?:chat|contact)_id|subject_user_id|subject_device_id/i);
  assert.match(migration, /auto_send_tenant_layer_unique[\s\S]*\(tenant_id, user_id\) where layer_kind = 'tenant'/i);
  assert.match(migration, /auto_send_relationship_layer_unique[\s\S]*relationship_subject_hmac_key_version, relationship_subject_hmac[\s\S]*layer_kind = 'relationship'/i);
  assert.match(migration, /auto_send_chat_layer_unique[\s\S]*chat_subject_hmac_key_version, chat_subject_hmac[\s\S]*layer_kind = 'chat'/i);
  assert.match(migration, /p_policy_user_id = p_user_id[\s\S]*is_tenant_member\(p_tenant_id, p_user_id\)/i);
});

test('relationship subjects are tenant-keyed HMACs with explicit key versions', () => {
  const graph = tableDefinition('relationship_graph_metadata');
  for (const side of ['source', 'target']) {
    assert.match(graph, new RegExp(`${side}_subject_hmac bytea not null check \\(octet_length\\(${side}_subject_hmac\\) = 32\\)`, 'i'));
    assert.match(graph, new RegExp(`${side}_subject_hmac_key_version smallint not null check \\(${side}_subject_hmac_key_version > 0\\)`, 'i'));
  }
  assert.doesNotMatch(graph, /subject_hash|contact_id|chat_id/i);
});

test('audit contract is append-only for authenticated clients', () => {
  assert.doesNotMatch(migration, /create policy [^\n]+ on public\.audit_events for (?:update|delete)/i);
  assert.match(migration, /grant select, insert on public\.audit_events to authenticated;/i);
});

test('Cloudflare example is placeholder-only and keeps Access enabled', () => {
  assert.match(wrangler, /CF_ACCESS_REQUIRED = "true"/);
  assert.match(wrangler, /YOUR_CLOUDFLARE_ACCOUNT_ID/);
  assert.match(wrangler, /YOUR_SUPABASE_PROJECT_REF/);
  assert.match(wrangler, /YOUR_ACCESS_APPLICATION_AUDIENCE/);
  assert.doesNotMatch(wrangler, /(?:service_role|private[_-]?key|client_secret)/i);
});
