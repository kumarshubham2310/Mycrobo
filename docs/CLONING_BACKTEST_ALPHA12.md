# MyCrobo conversation-wide cloning backtest — Alpha.12

Generated: 1 September 2026

## Why the acceptance standard changed

The previous benchmark could reward a safe placeholder even when it had not
understood the conversation. That defect was exposed by the real incoming turn
“I'm good, what are you doing today”, which was incorrectly treated as an
exact-time request and drafted as `[Add the actual time before sending]`.

That shortcut has been removed. “Today” by itself is now only a temporal word;
it does not require a date or time unless the complete incoming turn asks for a
time, date, availability, deadline or time-bound commitment.

## Method

The replacement is a chronological pre-reply holdout backtest. At many real
historical moments across direct conversations:

1. the real owner reply and everything after it are hidden;
2. MyCrobo receives only messages and derived behavioral evidence available at
   that moment;
3. the production conversation-state builder, relationship DNA, candidate
   generator and independent evaluator draft a reply;
4. the draft is compared with what the owner actually sent; and
5. every dimension is scored independently—no word-overlap metric is used.

A safe placeholder can pass commitment safety, but it cannot receive automatic
credit for intent or story understanding. Every aggregate dimension below its
release threshold becomes an architectural regression.

The final bounded run covered:

- 77 direct conversations read from 80 eligible conversations;
- 10,475 verified human text messages held in memory;
- 677 hidden owner-reply moments;
- 9 relationship contexts; and
- 25 incoming intents.

The report contains no raw message, contact identifier or chat identifier. The
backtest made zero external model calls and sent zero messages.

## Final measured result

| Independent gate | Result | Required | Status |
|---|---:|---:|---|
| Draft completion | 100.0% | 100.0% | Pass |
| Intent | 86.7% | 80.0% | Pass |
| Language/register | 75.3% | 85.0% | **Blocked** |
| Brevity | 71.9% | 80.0% | **Blocked** |
| Warmth | 99.3% | 80.0% | Pass |
| Formality | 68.2% | 80.0% | **Blocked** |
| Emoji behavior | 90.0% | 90.0% | Pass |
| Commitment safety | 100.0% | 100.0% | Pass |
| Story understanding | 97.9% | 95.0% | Pass |
| Cross-contact leakage prevention | 100.0% | 100.0% | Pass |

Strict all-nine acceptance was 31.9%; average conversation score was 86.9/100.
Owner-personalization improved the score by 3.1 points over the neutral local
fallback. There were zero generation errors, zero unsafe-commitment failures
and zero detected cross-contact leaks. Fourteen story cases failed, and 94 of
677 cases scored below 75.

This is deliberately stricter than the old reported 92.8% “compatible response
act”. That single number is retired because it concealed language, length and
register failures.

## Corrections retained after blinded iterations

- The complete current incoming turn is classified, not only its last bubble.
- Activity questions are separate from time/date/availability requests.
- Greeting plus a substantive question is treated as a question.
- Candidate generation is internally diverse and action requests cannot fall
  back to a meaningless acknowledgement.
- Language uses the person's stable evidence-backed writing mode before sparse
  intent-cell mirroring. This improved held-out language accuracy and reduced
  English overproduction.
- Reply length uses the larger per-person distribution as a stability prior;
  a length-aligned candidate may replace the winner only after the same safety
  gates and only when it is semantically competitive.
- Stable relationship atoms may shape style but can never become current facts.
- Message evidence is exact-chat scoped; foreign evidence IDs and foreign
  identifiers fail the backtest.

An attempted broad casual-address and hard length-bucket rule was rejected: it
looked plausible in examples but reduced unseen-history language, warmth,
formality and strict acceptance. It is not in the retained build.

## Release interpretation

The shown `today` failure is fixed and permanently covered by an architectural
regression test. The deterministic private fallback is now safer and more
context-aware, but this report does **not** certify universal or perfect tone
cloning. Language, brevity and formality remain red release gates.

Closing those gates requires a consented multilingual reasoning provider or a
trained on-device response model, plus person-disjoint calibration data and
blind human review. The currently configured Google project is quota/capacity
limited, so cloud-quality improvement is not claimed. The machine-readable,
content-free evidence is in `CLONING_BACKTEST_ALPHA12.json`.
