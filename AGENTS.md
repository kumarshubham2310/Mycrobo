# MyCrobo project instructions

These rules apply to this source tree and preserve the owner's standing requirements.

- This tree produces the desktop application in `MyCroboReboot-alpha9-compact-win32-x64`. Do not create or substitute another application.
- Preserve the active WhatsApp session, tenant registry, chat database, attachments, settings and feedback under the Electron user-data directory. Never use test fixtures against that directory.
- Do not send a real WhatsApp message during development, audit, replay, packaging or UI verification. Keep automatic sending disabled. Test the outbound boundary with mocks only unless the owner gives a separate, exact authorization.
- Do not upload raw chat history, media, credentials or derived private facts to a new provider. Cloud drafting requires explicit consent and sends only the bounded minimum context defined by the gateway policy.
- Treat historical cross-chat evidence as style/analogy only. Facts in a draft must come from the verified current conversation or explicit current user input.
- Keep account, tenant, person, chat and group boundaries explicit at storage, cache, retrieval, model and feedback layers.
- A disconnected, stale, wrong-account or incompletely synchronized connector cannot generate or send a live actionable reply. Cached history must be labelled read-only.
- The 1,500 C/S/T cells are a probabilistic routing taxonomy, not a response library and not permanent labels for people.
- Report provider route and fallback truth without fabricated tone percentages. Never label relationship/global evidence as person-specific.
- Use `apply_patch` for source edits. Preserve unrelated existing work. Rebuild and test the Go bridge whenever its source changes.
- Minimum pre-package checks: complete Node test suite, complete Go tests, `go vet`, forest and phrase-bank benchmarks, package/source parity, and an isolated desktop read-only smoke test.
- A passing mock suite does not certify real provider quality, complete WhatsApp history, owner-rated personalization or real delivery.
