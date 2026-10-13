import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../infrastructure/supabase/migrations/202610090001_trusted_relay_foundation.sql", import.meta.url), "utf8");
const fixture = await readFile(new URL("../infrastructure/supabase/verification/closed_pilot_rls_fixture.sql", import.meta.url), "utf8");
const tables = ["relay_pairing_challenges", "relay_sessions", "relay_envelopes", "relay_security_events"];

function tableDefinition(name) {
  const match = migration.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`, "iu"));
  assert.ok(match, `missing table definition for ${name}`);
  return match[1];
}

test("every trusted relay table is tenant/user scoped and forced through RLS", () => {
  for (const table of tables) {
    const definition = tableDefinition(table);
    assert.match(definition, /tenant_id uuid not null/iu);
    assert.match(definition, /user_id uuid not null/iu);
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`, "iu"));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security;`, "iu"));
    const policies = [...migration.matchAll(new RegExp(`create policy [^\\n]+ on public\\.${table}([\\s\\S]*?);`, "giu"))]
      .map((match) => match[0]).join("\n");
    assert.match(policies, /auth\.uid\(\)/iu, `${table} policies must bind to auth.uid()`);
  }
  assert.doesNotMatch(migration, /service[_-]?role|supabase[_-]?secret/iu);
});

test("relay storage is ciphertext-only, short-lived, immutable and never delivery-capable", () => {
  const envelope = tableDefinition("relay_envelopes");
  assert.match(envelope, /ciphertext bytea not null/iu);
  assert.match(envelope, /nonce bytea not null check \(octet_length\(nonce\) = 12\)/iu);
  assert.match(envelope, /aad_digest bytea not null check \(octet_length\(aad_digest\) = 32\)/iu);
  assert.match(envelope, /expires_at > created_at and expires_at <= created_at \+ interval '5 minutes'/iu);
  assert.match(envelope, /unique \(session_id, sender_device_id, sequence_number\)/iu);
  assert.doesNotMatch(envelope, /^\s*(?:message|body|content|caption|media|transcript|prompt|draft|plaintext)(?:_|\s)/imu);
  assert.doesNotMatch(migration, /(?:capability|capabilities)[^\n]*(?:send|deliver)/iu);
  assert.match(migration, /relay envelope authenticated fields are immutable/iu);
  assert.doesNotMatch(migration, /create policy [^\n]+ on public\.relay_(?:pairing_challenges|sessions|envelopes|security_events) for delete/iu);
});

test("relay device, session, relationship and chat bindings fail closed", () => {
  assert.match(migration, /device_kind in \('desktop_connector', 'web_client'\)/iu);
  assert.match(migration, /desktop_device\.device_kind = 'desktop_connector'/iu);
  assert.match(migration, /web_device\.device_kind = 'web_client'/iu);
  assert.match(migration, /session\.tenant_id = p_tenant_id[\s\S]*session\.user_id = p_user_id/iu);
  assert.match(migration, /p_capability = any\(session\.capabilities\)/iu);
  assert.match(migration, /pairing\.session_binding_digest = p_session_binding_digest[\s\S]*pairing\.pairing_state = 'consumed'/iu);
  assert.match(migration, /relationship_subject_hmac bytea[\s\S]*octet_length\(relationship_subject_hmac\) = 32/iu);
  assert.match(migration, /chat_subject_hmac bytea[\s\S]*octet_length\(chat_subject_hmac\) = 32/iu);
  assert.match(migration, /capability in \('chat_read', 'draft_request'\)[\s\S]*relationship_subject_hmac is not null[\s\S]*chat_subject_hmac is not null/iu);
});

test("pairing and session cryptographic bindings have bounded lifetimes and terminal states", () => {
  const pairing = tableDefinition("relay_pairing_challenges");
  const sessions = tableDefinition("relay_sessions");
  assert.match(pairing, /challenge_digest bytea not null check \(octet_length\(challenge_digest\) = 32\)/iu);
  assert.match(pairing, /session_binding_digest bytea not null check \(octet_length\(session_binding_digest\) = 32\)/iu);
  assert.match(pairing, /expires_at > created_at and expires_at <= created_at \+ interval '10 minutes'/iu);
  assert.match(sessions, /session_binding_digest bytea not null check \(octet_length\(session_binding_digest\) = 32\)/iu);
  assert.match(sessions, /expires_at > created_at and expires_at <= created_at \+ interval '30 days'/iu);
  assert.match(migration, /terminal relay pairing state is immutable/iu);
  assert.match(migration, /terminal relay session state is immutable/iu);
});

test("the synthetic RLS fixture covers every relay table without weakening authorization", () => {
  for (const table of tables) assert.match(fixture, new RegExp(`insert into public\\.${table}`, "iu"));
  assert.match(fixture, /desktop_connector/iu);
  assert.match(fixture, /web_client/iu);
  assert.doesNotMatch(fixture, /\b(?:alter|create|delete|drop|grant|revoke|truncate)\b/iu);
});
