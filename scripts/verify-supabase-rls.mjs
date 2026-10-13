import { loadSupabaseRlsVerificationConfig, verifySupabaseForcedRls } from "../contracts/supabase-rls-verifier.mjs";

try {
  const result = await verifySupabaseForcedRls(loadSupabaseRlsVerificationConfig(process.env));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: String(error?.code || "VERIFICATION_FAILED"), message: String(error?.message || "Supabase RLS verification failed closed.") }, null, 2)}\n`);
  process.exitCode = 1;
}
