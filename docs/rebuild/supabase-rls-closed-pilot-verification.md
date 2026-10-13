# Supabase closed-pilot RLS verification gate

## Purpose

`pnpm verify:supabase-rls` is a read-only live release gate for a separately configured, non-production Supabase test project. It proves two bounded controls from the deployed schema:

1. PostgreSQL reports `relrowsecurity=true` and `relforcerowsecurity=true` for all ten migrated tenant tables in `public`.
2. Two pre-existing, tenant-bound synthetic `authenticated` principals can each read exactly their own fixture row in every migrated table and cannot read the other tenant's row, including with an explicit foreign-tenant filter.

The gate is not a migration, seed, provisioning or cleanup tool. It contains no create, insert, update, delete, grant, policy or schema operation. It does not claim to exercise write policies; those require a separate rollback-guaranteed database test.

## Hard safety boundary

The verifier fails before network access unless all configuration is supplied explicitly. It accepts only:

- the exact HTTPS `https://<project-ref>.supabase.co` URL matching the project reference;
- the explicit confirmation `TEST_ONLY_MIGRATED_TENANT_RLS`;
- a PostgreSQL database comment exactly equal to `mycrobo:closed-pilot-test:v1:no-customer-data`, set only after confirming the dedicated project contains no customer data;
- two distinct UUID principals and two distinct UUID tenants;
- unexpired JWTs whose issuer is the configured project, whose role is `authenticated`, and whose signed `app_metadata` contains `mycrobo_verification: true` plus the matching `mycrobo_tenant_id`;
- exactly the ten allowlisted migrated `public` tables; and
- the fixed ten-table tenant data-plane allowlist.

The harness does not accept an arbitrary schema, table, field, payload or SQL statement. Its only management API statement is a fixed `SELECT` against `pg_catalog`. All data-plane calls are HTTP `GET` requests that select only each table's tenant/user ownership columns. Output contains no project reference, tokens, principal IDs or tenant IDs.

The Supabase management access token and both principal access tokens are secrets. Supply them only through an ephemeral CI secret store or protected local process environment. Never commit them to `.env`, source, a build artifact, screenshots or test logs.

## Reviewed operator-applied test fixture

The reviewed fixture contract is [closed_pilot_rls_fixture.sql](../../infrastructure/supabase/verification/closed_pilot_rls_fixture.sql). It is deliberately outside the production migration path and cannot be applied unchanged because its four UUID placeholders are invalid. It performs inserts only and refuses to run unless the database already has the exact no-customer-data marker, both Auth principals already exist with the required signed app metadata, all IDs are distinct, and neither tenant UUID exists.

An authorized operator must prepare the dedicated test project in this order:

1. Confirm the project is empty of customer and production data.
2. Apply `infrastructure/supabase/migrations/202610080001_closed_pilot_tenant_isolation.sql` using the normal reviewed migration workflow.
3. Create two test-only Supabase Auth users. Set each user's signed app metadata to `mycrobo_verification: true` and its distinct `mycrobo_tenant_id`. Record the two principal UUIDs; do not place credentials in this repository.
4. In an authorized SQL session, mark the confirmed test database with `COMMENT ON DATABASE "<exact-test-database-name>" IS 'mycrobo:closed-pilot-test:v1:no-customer-data';`. Never apply this marker to a database containing user or customer data.
5. Copy the reviewed fixture contract to an ephemeral location, replace all four placeholders with two distinct principal UUIDs and two distinct new tenant UUIDs, review the diff, then apply it once. Do not commit the rendered copy.
6. Obtain short-lived access tokens for the two synthetic users and supply the environment variables below.

The fixture creates two synthetic tenant owners plus one bounded row per owner in every migrated table. The migration's owner-membership trigger creates their active memberships. Child IDs are generated inside the fixture and tenant keys are derived from the supplied tenant UUIDs to avoid cross-run collisions. The verifier itself never changes or removes those records.

## Required environment variables

| Variable | Requirement |
| --- | --- |
| `MYCROBO_SUPABASE_RLS_VERIFY` | Exact value `1` |
| `MYCROBO_SUPABASE_TEST_CONFIRMATION` | Exact value `TEST_ONLY_MIGRATED_TENANT_RLS` |
| `MYCROBO_SUPABASE_TEST_URL` | Exact test-project HTTPS URL |
| `MYCROBO_SUPABASE_TEST_PROJECT_REF` | Matching test project reference |
| `MYCROBO_SUPABASE_TEST_ANON_KEY` | Test-project API key, supplied at runtime |
| `MYCROBO_SUPABASE_TEST_MANAGEMENT_TOKEN` | Runtime-only management token for the fixed catalog `SELECT` |
| `MYCROBO_SUPABASE_TEST_PRINCIPAL_A_JWT` | Unexpired access token for synthetic principal A |
| `MYCROBO_SUPABASE_TEST_PRINCIPAL_A_ID` | Principal A UUID matching JWT `sub` |
| `MYCROBO_SUPABASE_TEST_PRINCIPAL_B_JWT` | Unexpired access token for synthetic principal B |
| `MYCROBO_SUPABASE_TEST_PRINCIPAL_B_ID` | Principal B UUID matching JWT `sub` |
| `MYCROBO_SUPABASE_TEST_TENANT_A_ID` | Synthetic tenant A UUID matching A's signed claim and fixture |
| `MYCROBO_SUPABASE_TEST_TENANT_B_ID` | Synthetic tenant B UUID matching B's signed claim and fixture |

Run only after the protected environment is configured:

```text
pnpm verify:supabase-rls
```

A pass reports only content-free counts: ten forced-RLS tables, twenty own-row reads, twenty explicit cross-tenant read probes, zero cross-tenant rows and zero mutations. Missing configuration, a catalog mismatch, a stale or foreign principal, an unexpected own-row result, or any cross-tenant disclosure exits non-zero.

## Current evidence and blocker

The deterministic harness tests cover missing-configuration fail-closed behavior, exact project binding, signed synthetic-claim checks, missing/unexpected/non-forced catalog rows, the complete fixed read allowlist, unfiltered row leakage and symmetric explicit cross-tenant read leakage.

No live Supabase certification has been produced in this workspace because no dedicated closed-pilot test project, runtime credentials or short-lived synthetic principal tokens are configured. Running without them exits non-zero before network access with `CONFIGURATION_REQUIRED`. This external evidence blocker must not be bypassed or represented as a live pass.
