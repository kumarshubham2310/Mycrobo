# MyCrobo reply-personalization acceptance audit

Date: 2026-09-11

Scope: the alpha9 working source local reply path, tested with synthetic conversations only. No private chat body, contact identity, account identifier, or model credential is present in this suite. No connector or send path is invoked.

## Release decision

**Not acceptable for release:** 3 of 10 acceptance tests pass. The current local fallback remains safe in the tested commitment and group cases, but it does not yet produce adequately contextual or person-specific drafts.

Command used:

```text
node --experimental-strip-types --test audit/reply-personalization.acceptance.test.mjs
```

## Acceptance matrix

| Area | Required behaviour | Observed behaviour | Result |
|---|---|---|---|
| Factual statement | Respond to the meaning of an arrival update; do not merely acknowledge receipt | `Okay, good` | Fail |
| Direct factual question | Preserve the clear question and request the unknown answer/status as an editable fact | `What do you mean exactly?` | Fail |
| Time/commitment | Require owner input; never manufacture a schedule or promise | Editable input retained; no promise invented | Pass |
| Roman Hindi | Read the complete rain + umbrella turn and answer in Roman Hindi | `Kya hua exactly?` | Fail |
| Roman Gujarati | Recognise the time question, retain Gujarati register, and request the time | `Shu thayu exactly?` | Fail |
| Mixed language | Preserve the requested sharing action and keep the time-bound commitment editable | Action and editable input retained | Pass |
| Attachment continuity | Keep the document event inside the story and make the latest displayable event the verified target | Document omitted; older text remains the target | Fail |
| Group no-reply | Do not draft for an unaddressed group announcement | No draft | Pass |
| Person-specific distinction | Different learned relationship registers must produce different, recognisable voices | Casual person collapses to `Got it` | Fail |
| Portfolio diversity | In eight materially different situations, at most one vacuous reply and at least six materially distinct replies | 7 of 8 are vacuous | Fail |

## Exact failing release gates

1. **Semantic completeness:** a draft must answer the meaning of the full current turn, not map the last message to a generic phrase.
2. **Question resolution:** a clear factual question with unknown owner-side truth must yield an editable factual slot, not an unnecessary clarification question.
3. **Roman-script intent recognition:** Roman Hindi and Roman Gujarati time, weather, object and action expressions must route to the correct intent before drafting.
4. **Media continuity:** displayable image, document and video events must remain attached to the conversational turn and verified target.
5. **Person-specific style:** evidence-backed address form, language/register, response act, length and punctuation must materially affect the selected candidate.
6. **Candidate diversity:** candidate generation must be semantic, not a phrase-bank permutation. Generic acknowledgements must be penalised when they do not answer the live turn.
7. **Portfolio repetition:** the selected draft bank must stay below a 12.5% vacuous-reply rate in this small deterministic acceptance portfolio. The observed rate is 87.5%.

## Root-cause indications confirmed by the suite

- The local generator has explicit fallback branches for `Okay`, `Got it`, `Noted`, and `Thanks for sharing`.
- Unrecognised statements fall through to a safe acknowledgement instead of a situation plan.
- Semantic details such as rain + umbrella and vendor + approval are not carried into candidate construction.
- Language detection is lexical and misses common Roman-script forms such as the tested Gujarati time phrasing.
- The draft story is built from human text only, so the media event is absent from the same reasoning structure.
- Learned style is represented, but the safe-atom and generic alternative bank can still out-rank the person-specific voice.

## Independent baseline suite

The existing project suite was also run directly with Node because the host does not expose `npm` on `PATH`.

- Existing tests: 121
- Passed: 112
- Failed: 9

The nine failures are separate from this new acceptance suite and include stale evaluator/evidence assertions plus gateway fixture and persisted-state expectation drift. They must not be reported as green until reconciled.

## Required exit criteria for this defect

- 10/10 tests in `reply-personalization.acceptance.test.mjs` pass.
- No regression in commitment safety or group no-reply.
- A larger anonymised chronological holdout meets the previously defined gates for language, brevity, formality, story understanding, and cross-contact isolation.
- Repetitive/vacuous selections are measured on final selected drafts, not merely on candidate availability.
- The same incoming situation produces demonstrably different drafts when strong person-specific evidence differs, while factual content remains confined to the current conversation.
