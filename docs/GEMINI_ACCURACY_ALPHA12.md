# Gemini chat-and-characteristics accuracy check

Date: 1 September 2026  
Build: MyCrobo Desktop `1.0.0-alpha.12`

## Scope

This report combines a controlled repeatability check using synthetic conversation content with an explicitly authorised, unsent in-product repetition against two private conversations. It is not a product-wide tone-accuracy percentage. Private message bodies and recipient names are intentionally omitted from the recorded evidence.

The provider received exactly two top-level input domains:

1. `chat`: the bounded ordered OWNER/OTHER messages, chat kind and verified target message ID.
2. `characteristics`: person-specific owner writing examples, same-person response pairs, evidence-backed relationship features, response preferences, and a disabled same-profile fallback for this scenario.

Conversation-state records, coverage objects, safety metadata, backend freshness objects, sync details and user-state records were not transmitted. Their gates remained local.

## Scenario

Incoming synthetic message: `Aaj mood bahut off hai yaar`

Person-specific style evidence included short owner responses such as `Kya hua?`, `Bata na` and `Acha, kya hua`, plus two same-person response pairs. The expected behavior was a short Roman-Hindi invitation to explain, with no invented promise, time, action, number or fact.

## Iteration results

### Baseline discovery run

Five independent requests produced semantically suitable, concise, non-generic drafts with no invented facts. Only two selected candidates explicitly cited the verified target message. This exposed that target provenance was a soft score rather than a release gate.

Correction:

- The prompt now requires every candidate to include `chat.targetMessageId` in `evidenceIds`.
- The independent evaluator now hard-rejects any candidate missing that target citation.

### Post-provenance run

Four completed requests all returned a relevant Roman-Hindi draft, cited the target and passed factuality/style gates. One of five concurrent requests timed out at the provider boundary.

Correction:

- A primary model network timeout is now eligible for the same one-attempt Gemini 3.6 capacity fallback used for HTTP 429/5xx responses.
- `Hindi (Roman script)` is normalized to MyCrobo's canonical `Roman Hindi` label.

### Post-reliability sequential run

| Iteration | Selected draft | Language | Target cited | Invented fact/commitment | Result |
|---:|---|---|---|---|---|
| 1 | `Kya hua?` | Roman Hindi | Yes | None | Pass |
| 2 | `Kya hua?` | Roman Hindi | Yes | None | Pass |
| 3 | `Kya hua?` | Roman Hindi | Yes | None | Pass |

All three sequential requests passed relevance, role, language, brevity, non-generic response, number/commitment and target-provenance checks.

### In-product fact-safety repetition

A private direct chat whose newest message required a current personal fact was drafted three independent times. Each iteration returned an editable current-fact field and kept sending blocked until the user supplies that fact. Result: **3 of 3 passed** the no-invented-fact and no-implicit-commitment gates.

### In-product full-turn action repetition

A separate private Roman-Hindi conversation ended in a short instruction whose meaning depended on the two preceding incoming messages. The discovery run exposed an unacceptable failure: the initial candidates collapsed the full request into generic English acknowledgements. That failure drove four corrections:

- Language and intent are inferred from the complete consecutive incoming turn.
- A generic acknowledgement is hard-rejected for a concrete action request.
- Commitment-only imperatives are separated from requests that still require an unknown time, date, location, availability or status.
- The local fallback produces an action-specific Roman-Hindi response when the cloud route is unavailable.

After those corrections, three independent in-product generations all returned the same relevant, action-specific Roman-Hindi draft. All three drafts were discarded. Result: **3 of 3 passed** full-turn meaning, language, actionability and no-invented-time gates.

## Evidence statement

Across the two post-provenance synthetic rounds, every completed draft passed the controlled accuracy gates: 7 of 7. The single pre-reliability-fix timeout is not counted as an accurate output and is retained as availability evidence. The corrected timeout fallback is covered by an automated primary-timeout-to-Gemini-3.6 test. The two private in-product slices then passed 6 of 6 post-fix repetitions. Combined, **13 of 13 completed post-fix observations passed their scenario-specific gates**; this is evidence for those slices, not a general accuracy percentage.

This result supports the exact tested scenario only. A production quality claim still requires a consented, held-out multilingual evaluation set across the 15 interaction families, 10 relationship contexts and 10 communication modes, plus blind human ratings and per-slice failure thresholds.

## Privacy and cost evidence

- Real WhatsApp content was used only for the explicitly authorised in-product repetitions. The application transmitted only the bounded `chat` and `characteristics` domains, and the report stores no private message body or recipient name.
- No WhatsApp message was sent. Every generated draft was discarded.
- The key was supplied only through the protected runtime/test environment and is absent from source, package resources and this report.
- The final three sequential calls used 1,824 input tokens and 3,383 output-plus-thinking tokens in total.
- No tool, grounding service, previous-interaction identifier or message-send path was enabled.
