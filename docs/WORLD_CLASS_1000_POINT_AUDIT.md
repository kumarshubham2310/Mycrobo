# MyCrobo world-class product audit — 1,000 independent release criteria

> Current source family: 1.0.0-alpha.29. Each row is independently pass/fail-able. This matrix is a release standard, not a claim that all 1,000 gates have passed. `npm run audit:readiness` is the machine-enforced exact-build decision; no status label in this document alone is production evidence.

## Status definitions

- **Remediated alpha.6** — directly changed and covered in this pass.
- **Foundation implemented** — a product foundation exists; scale or independent certification may remain.
- **Release evidence required** — must not be called production-ready without exact-build evidence.

| ID | Domain | Independent requirement | Required evidence | Current state |
|---:|---|---|---|---|
| WCP-0001 | Product strategy | the promised user outcome has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0002 | Product strategy | the promised user outcome makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0003 | Product strategy | the promised user outcome removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0004 | Product strategy | the promised user outcome uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0005 | Product strategy | the promised user outcome provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0006 | Product strategy | the promised user outcome provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0007 | Product strategy | the promised user outcome represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0008 | Product strategy | the promised user outcome uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0009 | Product strategy | the promised user outcome remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0010 | Product strategy | the promised user outcome offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0011 | Product strategy | the promised user outcome supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0012 | Product strategy | the promised user outcome exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0013 | Product strategy | the promised user outcome keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0014 | Product strategy | the promised user outcome meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0015 | Product strategy | the promised user outcome remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0016 | Product strategy | the promised user outcome uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0017 | Product strategy | the promised user outcome works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0018 | Product strategy | the promised user outcome does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0019 | Product strategy | the promised user outcome contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0020 | Product strategy | the promised user outcome handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0021 | Product strategy | the promised user outcome has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0022 | Product strategy | the promised user outcome has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0023 | Product strategy | the promised user outcome has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0024 | Product strategy | the promised user outcome has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0025 | Product strategy | the promised user outcome degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0026 | Product strategy | the promised user outcome shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0027 | Product strategy | the promised user outcome orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0028 | Product strategy | the promised user outcome persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0029 | Product strategy | the promised user outcome is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0030 | Product strategy | the promised user outcome retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0031 | Product strategy | the promised user outcome uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0032 | Product strategy | the promised user outcome minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0033 | Product strategy | the promised user outcome never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0034 | Product strategy | the promised user outcome has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0035 | Product strategy | the promised user outcome has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0036 | Product strategy | the promised user outcome has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0037 | Product strategy | the promised user outcome has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0038 | Product strategy | the promised user outcome has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0039 | Product strategy | the promised user outcome has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0040 | Product strategy | the promised user outcome has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0041 | Information architecture | the product's content hierarchy has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0042 | Information architecture | the product's content hierarchy makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0043 | Information architecture | the product's content hierarchy removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0044 | Information architecture | the product's content hierarchy uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0045 | Information architecture | the product's content hierarchy provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0046 | Information architecture | the product's content hierarchy provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0047 | Information architecture | the product's content hierarchy represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0048 | Information architecture | the product's content hierarchy uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0049 | Information architecture | the product's content hierarchy remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0050 | Information architecture | the product's content hierarchy offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0051 | Information architecture | the product's content hierarchy supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0052 | Information architecture | the product's content hierarchy exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0053 | Information architecture | the product's content hierarchy keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0054 | Information architecture | the product's content hierarchy meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0055 | Information architecture | the product's content hierarchy remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0056 | Information architecture | the product's content hierarchy uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0057 | Information architecture | the product's content hierarchy works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0058 | Information architecture | the product's content hierarchy does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0059 | Information architecture | the product's content hierarchy contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0060 | Information architecture | the product's content hierarchy handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0061 | Information architecture | the product's content hierarchy has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0062 | Information architecture | the product's content hierarchy has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0063 | Information architecture | the product's content hierarchy has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0064 | Information architecture | the product's content hierarchy has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0065 | Information architecture | the product's content hierarchy degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0066 | Information architecture | the product's content hierarchy shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0067 | Information architecture | the product's content hierarchy orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0068 | Information architecture | the product's content hierarchy persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0069 | Information architecture | the product's content hierarchy is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0070 | Information architecture | the product's content hierarchy retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0071 | Information architecture | the product's content hierarchy uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0072 | Information architecture | the product's content hierarchy minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0073 | Information architecture | the product's content hierarchy never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0074 | Information architecture | the product's content hierarchy has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0075 | Information architecture | the product's content hierarchy has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0076 | Information architecture | the product's content hierarchy has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0077 | Information architecture | the product's content hierarchy has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0078 | Information architecture | the product's content hierarchy has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0079 | Information architecture | the product's content hierarchy has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0080 | Information architecture | the product's content hierarchy has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0081 | Primary navigation | movement between product areas has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0082 | Primary navigation | movement between product areas makes the primary action immediately discoverable. | a five-second usability check. | Remediated alpha.6 |
| WCP-0083 | Primary navigation | movement between product areas removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0084 | Primary navigation | movement between product areas uses a safe and useful default. | a default-state test. | Remediated alpha.6 |
| WCP-0085 | Primary navigation | movement between product areas provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0086 | Primary navigation | movement between product areas provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0087 | Primary navigation | movement between product areas represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0088 | Primary navigation | movement between product areas uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0089 | Primary navigation | movement between product areas remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0090 | Primary navigation | movement between product areas offers one obvious recovery action that preserves work. | a recovery-flow test. | Remediated alpha.6 |
| WCP-0091 | Primary navigation | movement between product areas supports a complete keyboard path. | a keyboard-only walkthrough. | Remediated alpha.6 |
| WCP-0092 | Primary navigation | movement between product areas exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Remediated alpha.6 |
| WCP-0093 | Primary navigation | movement between product areas keeps focus visible and returns it after transient UI closes. | a focus-order test. | Remediated alpha.6 |
| WCP-0094 | Primary navigation | movement between product areas meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0095 | Primary navigation | movement between product areas remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0096 | Primary navigation | movement between product areas uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0097 | Primary navigation | movement between product areas works without clipping at its minimum supported viewport. | a viewport matrix. | Remediated alpha.6 |
| WCP-0098 | Primary navigation | movement between product areas does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0099 | Primary navigation | movement between product areas contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0100 | Primary navigation | movement between product areas handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0101 | Primary navigation | movement between product areas has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0102 | Primary navigation | movement between product areas has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0103 | Primary navigation | movement between product areas has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0104 | Primary navigation | movement between product areas has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0105 | Primary navigation | movement between product areas degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0106 | Primary navigation | movement between product areas shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0107 | Primary navigation | movement between product areas orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0108 | Primary navigation | movement between product areas persists only intentional user state. | a restart and reload test. | Remediated alpha.6 |
| WCP-0109 | Primary navigation | movement between product areas is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0110 | Primary navigation | movement between product areas retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0111 | Primary navigation | movement between product areas uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0112 | Primary navigation | movement between product areas minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0113 | Primary navigation | movement between product areas never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0114 | Primary navigation | movement between product areas has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0115 | Primary navigation | movement between product areas has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0116 | Primary navigation | movement between product areas has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0117 | Primary navigation | movement between product areas has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0118 | Primary navigation | movement between product areas has visual and interaction regression coverage. | a packaged UI test. | Remediated alpha.6 |
| WCP-0119 | Primary navigation | movement between product areas has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0120 | Primary navigation | movement between product areas has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0121 | Conversation list | finding and selecting a conversation has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0122 | Conversation list | finding and selecting a conversation makes the primary action immediately discoverable. | a five-second usability check. | Remediated alpha.6 |
| WCP-0123 | Conversation list | finding and selecting a conversation removes actions and copy that do not change the outcome. | a redundancy review. | Remediated alpha.6 |
| WCP-0124 | Conversation list | finding and selecting a conversation uses a safe and useful default. | a default-state test. | Remediated alpha.6 |
| WCP-0125 | Conversation list | finding and selecting a conversation provides a clear empty state. | an empty-fixture screenshot. | Remediated alpha.6 |
| WCP-0126 | Conversation list | finding and selecting a conversation provides a non-blocking loading state. | a throttled-load test. | Remediated alpha.6 |
| WCP-0127 | Conversation list | finding and selecting a conversation represents partial data without implying completeness. | a partial-data fixture. | Remediated alpha.6 |
| WCP-0128 | Conversation list | finding and selecting a conversation uses plain-language errors without exposing internals. | an error-copy test. | Remediated alpha.6 |
| WCP-0129 | Conversation list | finding and selecting a conversation remains truthful and useful while offline. | an offline test. | Remediated alpha.6 |
| WCP-0130 | Conversation list | finding and selecting a conversation offers one obvious recovery action that preserves work. | a recovery-flow test. | Remediated alpha.6 |
| WCP-0131 | Conversation list | finding and selecting a conversation supports a complete keyboard path. | a keyboard-only walkthrough. | Remediated alpha.6 |
| WCP-0132 | Conversation list | finding and selecting a conversation exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Remediated alpha.6 |
| WCP-0133 | Conversation list | finding and selecting a conversation keeps focus visible and returns it after transient UI closes. | a focus-order test. | Remediated alpha.6 |
| WCP-0134 | Conversation list | finding and selecting a conversation meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0135 | Conversation list | finding and selecting a conversation remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0136 | Conversation list | finding and selecting a conversation uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0137 | Conversation list | finding and selecting a conversation works without clipping at its minimum supported viewport. | a viewport matrix. | Remediated alpha.6 |
| WCP-0138 | Conversation list | finding and selecting a conversation does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0139 | Conversation list | finding and selecting a conversation contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Remediated alpha.6 |
| WCP-0140 | Conversation list | finding and selecting a conversation handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Remediated alpha.6 |
| WCP-0141 | Conversation list | finding and selecting a conversation has a measurable latency budget. | a percentile performance measurement. | Remediated alpha.6 |
| WCP-0142 | Conversation list | finding and selecting a conversation has a measurable memory budget. | a sustained-session memory measurement. | Remediated alpha.6 |
| WCP-0143 | Conversation list | finding and selecting a conversation has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0144 | Conversation list | finding and selecting a conversation has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0145 | Conversation list | finding and selecting a conversation degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0146 | Conversation list | finding and selecting a conversation shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0147 | Conversation list | finding and selecting a conversation orders records deterministically. | an equal-timestamp and replay test. | Remediated alpha.6 |
| WCP-0148 | Conversation list | finding and selecting a conversation persists only intentional user state. | a restart and reload test. | Remediated alpha.6 |
| WCP-0149 | Conversation list | finding and selecting a conversation is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0150 | Conversation list | finding and selecting a conversation retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0151 | Conversation list | finding and selecting a conversation uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0152 | Conversation list | finding and selecting a conversation minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0153 | Conversation list | finding and selecting a conversation never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0154 | Conversation list | finding and selecting a conversation has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0155 | Conversation list | finding and selecting a conversation has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0156 | Conversation list | finding and selecting a conversation has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0157 | Conversation list | finding and selecting a conversation has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0158 | Conversation list | finding and selecting a conversation has visual and interaction regression coverage. | a packaged UI test. | Remediated alpha.6 |
| WCP-0159 | Conversation list | finding and selecting a conversation has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0160 | Conversation list | finding and selecting a conversation has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0161 | Conversation reader | understanding the verified conversation story has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0162 | Conversation reader | understanding the verified conversation story makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0163 | Conversation reader | understanding the verified conversation story removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0164 | Conversation reader | understanding the verified conversation story uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0165 | Conversation reader | understanding the verified conversation story provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0166 | Conversation reader | understanding the verified conversation story provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0167 | Conversation reader | understanding the verified conversation story represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0168 | Conversation reader | understanding the verified conversation story uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0169 | Conversation reader | understanding the verified conversation story remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0170 | Conversation reader | understanding the verified conversation story offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0171 | Conversation reader | understanding the verified conversation story supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0172 | Conversation reader | understanding the verified conversation story exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0173 | Conversation reader | understanding the verified conversation story keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0174 | Conversation reader | understanding the verified conversation story meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0175 | Conversation reader | understanding the verified conversation story remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0176 | Conversation reader | understanding the verified conversation story uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0177 | Conversation reader | understanding the verified conversation story works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0178 | Conversation reader | understanding the verified conversation story does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0179 | Conversation reader | understanding the verified conversation story contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0180 | Conversation reader | understanding the verified conversation story handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0181 | Conversation reader | understanding the verified conversation story has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0182 | Conversation reader | understanding the verified conversation story has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0183 | Conversation reader | understanding the verified conversation story has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0184 | Conversation reader | understanding the verified conversation story has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0185 | Conversation reader | understanding the verified conversation story degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0186 | Conversation reader | understanding the verified conversation story shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0187 | Conversation reader | understanding the verified conversation story orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0188 | Conversation reader | understanding the verified conversation story persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0189 | Conversation reader | understanding the verified conversation story is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0190 | Conversation reader | understanding the verified conversation story retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0191 | Conversation reader | understanding the verified conversation story uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0192 | Conversation reader | understanding the verified conversation story minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0193 | Conversation reader | understanding the verified conversation story never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0194 | Conversation reader | understanding the verified conversation story has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0195 | Conversation reader | understanding the verified conversation story has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0196 | Conversation reader | understanding the verified conversation story has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0197 | Conversation reader | understanding the verified conversation story has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0198 | Conversation reader | understanding the verified conversation story has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0199 | Conversation reader | understanding the verified conversation story has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0200 | Conversation reader | understanding the verified conversation story has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0201 | Reply composition | drafting, editing and deliberate sending has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0202 | Reply composition | drafting, editing and deliberate sending makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0203 | Reply composition | drafting, editing and deliberate sending removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0204 | Reply composition | drafting, editing and deliberate sending uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0205 | Reply composition | drafting, editing and deliberate sending provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0206 | Reply composition | drafting, editing and deliberate sending provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0207 | Reply composition | drafting, editing and deliberate sending represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0208 | Reply composition | drafting, editing and deliberate sending uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0209 | Reply composition | drafting, editing and deliberate sending remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0210 | Reply composition | drafting, editing and deliberate sending offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0211 | Reply composition | drafting, editing and deliberate sending supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0212 | Reply composition | drafting, editing and deliberate sending exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0213 | Reply composition | drafting, editing and deliberate sending keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0214 | Reply composition | drafting, editing and deliberate sending meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0215 | Reply composition | drafting, editing and deliberate sending remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0216 | Reply composition | drafting, editing and deliberate sending uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0217 | Reply composition | drafting, editing and deliberate sending works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0218 | Reply composition | drafting, editing and deliberate sending does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0219 | Reply composition | drafting, editing and deliberate sending contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0220 | Reply composition | drafting, editing and deliberate sending handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0221 | Reply composition | drafting, editing and deliberate sending has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0222 | Reply composition | drafting, editing and deliberate sending has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0223 | Reply composition | drafting, editing and deliberate sending has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0224 | Reply composition | drafting, editing and deliberate sending has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0225 | Reply composition | drafting, editing and deliberate sending degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0226 | Reply composition | drafting, editing and deliberate sending shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0227 | Reply composition | drafting, editing and deliberate sending orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0228 | Reply composition | drafting, editing and deliberate sending persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0229 | Reply composition | drafting, editing and deliberate sending is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0230 | Reply composition | drafting, editing and deliberate sending retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0231 | Reply composition | drafting, editing and deliberate sending uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0232 | Reply composition | drafting, editing and deliberate sending minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0233 | Reply composition | drafting, editing and deliberate sending never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0234 | Reply composition | drafting, editing and deliberate sending has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0235 | Reply composition | drafting, editing and deliberate sending has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0236 | Reply composition | drafting, editing and deliberate sending has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0237 | Reply composition | drafting, editing and deliberate sending has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0238 | Reply composition | drafting, editing and deliberate sending has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0239 | Reply composition | drafting, editing and deliberate sending has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0240 | Reply composition | drafting, editing and deliberate sending has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0241 | Decision queue | items that genuinely require owner judgement has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0242 | Decision queue | items that genuinely require owner judgement makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0243 | Decision queue | items that genuinely require owner judgement removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0244 | Decision queue | items that genuinely require owner judgement uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0245 | Decision queue | items that genuinely require owner judgement provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0246 | Decision queue | items that genuinely require owner judgement provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0247 | Decision queue | items that genuinely require owner judgement represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0248 | Decision queue | items that genuinely require owner judgement uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0249 | Decision queue | items that genuinely require owner judgement remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0250 | Decision queue | items that genuinely require owner judgement offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0251 | Decision queue | items that genuinely require owner judgement supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0252 | Decision queue | items that genuinely require owner judgement exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0253 | Decision queue | items that genuinely require owner judgement keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0254 | Decision queue | items that genuinely require owner judgement meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0255 | Decision queue | items that genuinely require owner judgement remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0256 | Decision queue | items that genuinely require owner judgement uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0257 | Decision queue | items that genuinely require owner judgement works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0258 | Decision queue | items that genuinely require owner judgement does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0259 | Decision queue | items that genuinely require owner judgement contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0260 | Decision queue | items that genuinely require owner judgement handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0261 | Decision queue | items that genuinely require owner judgement has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0262 | Decision queue | items that genuinely require owner judgement has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0263 | Decision queue | items that genuinely require owner judgement has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0264 | Decision queue | items that genuinely require owner judgement has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0265 | Decision queue | items that genuinely require owner judgement degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0266 | Decision queue | items that genuinely require owner judgement shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0267 | Decision queue | items that genuinely require owner judgement orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0268 | Decision queue | items that genuinely require owner judgement persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0269 | Decision queue | items that genuinely require owner judgement is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0270 | Decision queue | items that genuinely require owner judgement retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0271 | Decision queue | items that genuinely require owner judgement uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0272 | Decision queue | items that genuinely require owner judgement minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0273 | Decision queue | items that genuinely require owner judgement never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0274 | Decision queue | items that genuinely require owner judgement has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0275 | Decision queue | items that genuinely require owner judgement has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0276 | Decision queue | items that genuinely require owner judgement has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0277 | Decision queue | items that genuinely require owner judgement has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0278 | Decision queue | items that genuinely require owner judgement has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0279 | Decision queue | items that genuinely require owner judgement has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0280 | Decision queue | items that genuinely require owner judgement has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0281 | Task system | concrete actions owned by the user has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0282 | Task system | concrete actions owned by the user makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0283 | Task system | concrete actions owned by the user removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0284 | Task system | concrete actions owned by the user uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0285 | Task system | concrete actions owned by the user provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0286 | Task system | concrete actions owned by the user provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0287 | Task system | concrete actions owned by the user represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0288 | Task system | concrete actions owned by the user uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0289 | Task system | concrete actions owned by the user remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0290 | Task system | concrete actions owned by the user offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0291 | Task system | concrete actions owned by the user supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0292 | Task system | concrete actions owned by the user exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0293 | Task system | concrete actions owned by the user keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0294 | Task system | concrete actions owned by the user meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0295 | Task system | concrete actions owned by the user remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0296 | Task system | concrete actions owned by the user uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0297 | Task system | concrete actions owned by the user works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0298 | Task system | concrete actions owned by the user does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0299 | Task system | concrete actions owned by the user contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0300 | Task system | concrete actions owned by the user handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0301 | Task system | concrete actions owned by the user has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0302 | Task system | concrete actions owned by the user has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0303 | Task system | concrete actions owned by the user has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0304 | Task system | concrete actions owned by the user has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0305 | Task system | concrete actions owned by the user degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0306 | Task system | concrete actions owned by the user shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0307 | Task system | concrete actions owned by the user orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0308 | Task system | concrete actions owned by the user persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0309 | Task system | concrete actions owned by the user is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0310 | Task system | concrete actions owned by the user retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0311 | Task system | concrete actions owned by the user uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0312 | Task system | concrete actions owned by the user minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0313 | Task system | concrete actions owned by the user never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0314 | Task system | concrete actions owned by the user has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0315 | Task system | concrete actions owned by the user has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0316 | Task system | concrete actions owned by the user has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0317 | Task system | concrete actions owned by the user has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0318 | Task system | concrete actions owned by the user has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0319 | Task system | concrete actions owned by the user has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0320 | Task system | concrete actions owned by the user has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0321 | Follow-up system | commitments the user is waiting to receive has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0322 | Follow-up system | commitments the user is waiting to receive makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0323 | Follow-up system | commitments the user is waiting to receive removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0324 | Follow-up system | commitments the user is waiting to receive uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0325 | Follow-up system | commitments the user is waiting to receive provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0326 | Follow-up system | commitments the user is waiting to receive provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0327 | Follow-up system | commitments the user is waiting to receive represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0328 | Follow-up system | commitments the user is waiting to receive uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0329 | Follow-up system | commitments the user is waiting to receive remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0330 | Follow-up system | commitments the user is waiting to receive offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0331 | Follow-up system | commitments the user is waiting to receive supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0332 | Follow-up system | commitments the user is waiting to receive exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0333 | Follow-up system | commitments the user is waiting to receive keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0334 | Follow-up system | commitments the user is waiting to receive meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0335 | Follow-up system | commitments the user is waiting to receive remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0336 | Follow-up system | commitments the user is waiting to receive uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0337 | Follow-up system | commitments the user is waiting to receive works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0338 | Follow-up system | commitments the user is waiting to receive does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0339 | Follow-up system | commitments the user is waiting to receive contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0340 | Follow-up system | commitments the user is waiting to receive handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0341 | Follow-up system | commitments the user is waiting to receive has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0342 | Follow-up system | commitments the user is waiting to receive has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0343 | Follow-up system | commitments the user is waiting to receive has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0344 | Follow-up system | commitments the user is waiting to receive has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0345 | Follow-up system | commitments the user is waiting to receive degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0346 | Follow-up system | commitments the user is waiting to receive shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0347 | Follow-up system | commitments the user is waiting to receive orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0348 | Follow-up system | commitments the user is waiting to receive persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0349 | Follow-up system | commitments the user is waiting to receive is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0350 | Follow-up system | commitments the user is waiting to receive retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0351 | Follow-up system | commitments the user is waiting to receive uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0352 | Follow-up system | commitments the user is waiting to receive minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0353 | Follow-up system | commitments the user is waiting to receive never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0354 | Follow-up system | commitments the user is waiting to receive has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0355 | Follow-up system | commitments the user is waiting to receive has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0356 | Follow-up system | commitments the user is waiting to receive has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0357 | Follow-up system | commitments the user is waiting to receive has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0358 | Follow-up system | commitments the user is waiting to receive has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0359 | Follow-up system | commitments the user is waiting to receive has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0360 | Follow-up system | commitments the user is waiting to receive has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0361 | Settings | controls that materially change behavior has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0362 | Settings | controls that materially change behavior makes the primary action immediately discoverable. | a five-second usability check. | Remediated alpha.6 |
| WCP-0363 | Settings | controls that materially change behavior removes actions and copy that do not change the outcome. | a redundancy review. | Remediated alpha.6 |
| WCP-0364 | Settings | controls that materially change behavior uses a safe and useful default. | a default-state test. | Remediated alpha.6 |
| WCP-0365 | Settings | controls that materially change behavior provides a clear empty state. | an empty-fixture screenshot. | Remediated alpha.6 |
| WCP-0366 | Settings | controls that materially change behavior provides a non-blocking loading state. | a throttled-load test. | Remediated alpha.6 |
| WCP-0367 | Settings | controls that materially change behavior represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0368 | Settings | controls that materially change behavior uses plain-language errors without exposing internals. | an error-copy test. | Remediated alpha.6 |
| WCP-0369 | Settings | controls that materially change behavior remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0370 | Settings | controls that materially change behavior offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0371 | Settings | controls that materially change behavior supports a complete keyboard path. | a keyboard-only walkthrough. | Remediated alpha.6 |
| WCP-0372 | Settings | controls that materially change behavior exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Remediated alpha.6 |
| WCP-0373 | Settings | controls that materially change behavior keeps focus visible and returns it after transient UI closes. | a focus-order test. | Remediated alpha.6 |
| WCP-0374 | Settings | controls that materially change behavior meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0375 | Settings | controls that materially change behavior remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0376 | Settings | controls that materially change behavior uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0377 | Settings | controls that materially change behavior works without clipping at its minimum supported viewport. | a viewport matrix. | Remediated alpha.6 |
| WCP-0378 | Settings | controls that materially change behavior does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0379 | Settings | controls that materially change behavior contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Remediated alpha.6 |
| WCP-0380 | Settings | controls that materially change behavior handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0381 | Settings | controls that materially change behavior has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0382 | Settings | controls that materially change behavior has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0383 | Settings | controls that materially change behavior has a measurable disk budget and retention policy. | a before-and-after storage report. | Remediated alpha.6 |
| WCP-0384 | Settings | controls that materially change behavior has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0385 | Settings | controls that materially change behavior degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0386 | Settings | controls that materially change behavior shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0387 | Settings | controls that materially change behavior orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0388 | Settings | controls that materially change behavior persists only intentional user state. | a restart and reload test. | Remediated alpha.6 |
| WCP-0389 | Settings | controls that materially change behavior is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0390 | Settings | controls that materially change behavior retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0391 | Settings | controls that materially change behavior uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0392 | Settings | controls that materially change behavior minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0393 | Settings | controls that materially change behavior never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0394 | Settings | controls that materially change behavior has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0395 | Settings | controls that materially change behavior has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0396 | Settings | controls that materially change behavior has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0397 | Settings | controls that materially change behavior has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0398 | Settings | controls that materially change behavior has visual and interaction regression coverage. | a packaged UI test. | Remediated alpha.6 |
| WCP-0399 | Settings | controls that materially change behavior has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0400 | Settings | controls that materially change behavior has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0401 | Onboarding and connection | first-run consent and connection recovery has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0402 | Onboarding and connection | first-run consent and connection recovery makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0403 | Onboarding and connection | first-run consent and connection recovery removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0404 | Onboarding and connection | first-run consent and connection recovery uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0405 | Onboarding and connection | first-run consent and connection recovery provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0406 | Onboarding and connection | first-run consent and connection recovery provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0407 | Onboarding and connection | first-run consent and connection recovery represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0408 | Onboarding and connection | first-run consent and connection recovery uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0409 | Onboarding and connection | first-run consent and connection recovery remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0410 | Onboarding and connection | first-run consent and connection recovery offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0411 | Onboarding and connection | first-run consent and connection recovery supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0412 | Onboarding and connection | first-run consent and connection recovery exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0413 | Onboarding and connection | first-run consent and connection recovery keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0414 | Onboarding and connection | first-run consent and connection recovery meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0415 | Onboarding and connection | first-run consent and connection recovery remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0416 | Onboarding and connection | first-run consent and connection recovery uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0417 | Onboarding and connection | first-run consent and connection recovery works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0418 | Onboarding and connection | first-run consent and connection recovery does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0419 | Onboarding and connection | first-run consent and connection recovery contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0420 | Onboarding and connection | first-run consent and connection recovery handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0421 | Onboarding and connection | first-run consent and connection recovery has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0422 | Onboarding and connection | first-run consent and connection recovery has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0423 | Onboarding and connection | first-run consent and connection recovery has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0424 | Onboarding and connection | first-run consent and connection recovery has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0425 | Onboarding and connection | first-run consent and connection recovery degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0426 | Onboarding and connection | first-run consent and connection recovery shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0427 | Onboarding and connection | first-run consent and connection recovery orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0428 | Onboarding and connection | first-run consent and connection recovery persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0429 | Onboarding and connection | first-run consent and connection recovery is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0430 | Onboarding and connection | first-run consent and connection recovery retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0431 | Onboarding and connection | first-run consent and connection recovery uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0432 | Onboarding and connection | first-run consent and connection recovery minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0433 | Onboarding and connection | first-run consent and connection recovery never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0434 | Onboarding and connection | first-run consent and connection recovery has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0435 | Onboarding and connection | first-run consent and connection recovery has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0436 | Onboarding and connection | first-run consent and connection recovery has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0437 | Onboarding and connection | first-run consent and connection recovery has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0438 | Onboarding and connection | first-run consent and connection recovery has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0439 | Onboarding and connection | first-run consent and connection recovery has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0440 | Onboarding and connection | first-run consent and connection recovery has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0441 | Accessibility | use by people with varied access needs has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0442 | Accessibility | use by people with varied access needs makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0443 | Accessibility | use by people with varied access needs removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0444 | Accessibility | use by people with varied access needs uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0445 | Accessibility | use by people with varied access needs provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0446 | Accessibility | use by people with varied access needs provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0447 | Accessibility | use by people with varied access needs represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0448 | Accessibility | use by people with varied access needs uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0449 | Accessibility | use by people with varied access needs remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0450 | Accessibility | use by people with varied access needs offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0451 | Accessibility | use by people with varied access needs supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0452 | Accessibility | use by people with varied access needs exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0453 | Accessibility | use by people with varied access needs keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0454 | Accessibility | use by people with varied access needs meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0455 | Accessibility | use by people with varied access needs remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0456 | Accessibility | use by people with varied access needs uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0457 | Accessibility | use by people with varied access needs works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0458 | Accessibility | use by people with varied access needs does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0459 | Accessibility | use by people with varied access needs contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0460 | Accessibility | use by people with varied access needs handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0461 | Accessibility | use by people with varied access needs has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0462 | Accessibility | use by people with varied access needs has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0463 | Accessibility | use by people with varied access needs has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0464 | Accessibility | use by people with varied access needs has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0465 | Accessibility | use by people with varied access needs degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0466 | Accessibility | use by people with varied access needs shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0467 | Accessibility | use by people with varied access needs orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0468 | Accessibility | use by people with varied access needs persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0469 | Accessibility | use by people with varied access needs is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0470 | Accessibility | use by people with varied access needs retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0471 | Accessibility | use by people with varied access needs uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0472 | Accessibility | use by people with varied access needs minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0473 | Accessibility | use by people with varied access needs never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0474 | Accessibility | use by people with varied access needs has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0475 | Accessibility | use by people with varied access needs has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0476 | Accessibility | use by people with varied access needs has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0477 | Accessibility | use by people with varied access needs has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0478 | Accessibility | use by people with varied access needs has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0479 | Accessibility | use by people with varied access needs has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0480 | Accessibility | use by people with varied access needs has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0481 | Visual system | brand, typography, spacing, color and hierarchy has one explicit user outcome. | a written acceptance statement. | Remediated alpha.6 |
| WCP-0482 | Visual system | brand, typography, spacing, color and hierarchy makes the primary action immediately discoverable. | a five-second usability check. | Remediated alpha.6 |
| WCP-0483 | Visual system | brand, typography, spacing, color and hierarchy removes actions and copy that do not change the outcome. | a redundancy review. | Remediated alpha.6 |
| WCP-0484 | Visual system | brand, typography, spacing, color and hierarchy uses a safe and useful default. | a default-state test. | Remediated alpha.6 |
| WCP-0485 | Visual system | brand, typography, spacing, color and hierarchy provides a clear empty state. | an empty-fixture screenshot. | Remediated alpha.6 |
| WCP-0486 | Visual system | brand, typography, spacing, color and hierarchy provides a non-blocking loading state. | a throttled-load test. | Remediated alpha.6 |
| WCP-0487 | Visual system | brand, typography, spacing, color and hierarchy represents partial data without implying completeness. | a partial-data fixture. | Remediated alpha.6 |
| WCP-0488 | Visual system | brand, typography, spacing, color and hierarchy uses plain-language errors without exposing internals. | an error-copy test. | Remediated alpha.6 |
| WCP-0489 | Visual system | brand, typography, spacing, color and hierarchy remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0490 | Visual system | brand, typography, spacing, color and hierarchy offers one obvious recovery action that preserves work. | a recovery-flow test. | Remediated alpha.6 |
| WCP-0491 | Visual system | brand, typography, spacing, color and hierarchy supports a complete keyboard path. | a keyboard-only walkthrough. | Remediated alpha.6 |
| WCP-0492 | Visual system | brand, typography, spacing, color and hierarchy exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Remediated alpha.6 |
| WCP-0493 | Visual system | brand, typography, spacing, color and hierarchy keeps focus visible and returns it after transient UI closes. | a focus-order test. | Remediated alpha.6 |
| WCP-0494 | Visual system | brand, typography, spacing, color and hierarchy meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Remediated alpha.6 |
| WCP-0495 | Visual system | brand, typography, spacing, color and hierarchy remains usable at 200% text scaling. | a text-zoom screenshot. | Remediated alpha.6 |
| WCP-0496 | Visual system | brand, typography, spacing, color and hierarchy uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Remediated alpha.6 |
| WCP-0497 | Visual system | brand, typography, spacing, color and hierarchy works without clipping at its minimum supported viewport. | a viewport matrix. | Remediated alpha.6 |
| WCP-0498 | Visual system | brand, typography, spacing, color and hierarchy does not encode meaning only in color, icon or position. | a multimodal-cue review. | Remediated alpha.6 |
| WCP-0499 | Visual system | brand, typography, spacing, color and hierarchy contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Remediated alpha.6 |
| WCP-0500 | Visual system | brand, typography, spacing, color and hierarchy handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0501 | Visual system | brand, typography, spacing, color and hierarchy has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0502 | Visual system | brand, typography, spacing, color and hierarchy has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0503 | Visual system | brand, typography, spacing, color and hierarchy has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0504 | Visual system | brand, typography, spacing, color and hierarchy has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0505 | Visual system | brand, typography, spacing, color and hierarchy degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0506 | Visual system | brand, typography, spacing, color and hierarchy shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0507 | Visual system | brand, typography, spacing, color and hierarchy orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0508 | Visual system | brand, typography, spacing, color and hierarchy persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0509 | Visual system | brand, typography, spacing, color and hierarchy is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0510 | Visual system | brand, typography, spacing, color and hierarchy retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0511 | Visual system | brand, typography, spacing, color and hierarchy uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0512 | Visual system | brand, typography, spacing, color and hierarchy minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0513 | Visual system | brand, typography, spacing, color and hierarchy never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0514 | Visual system | brand, typography, spacing, color and hierarchy has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0515 | Visual system | brand, typography, spacing, color and hierarchy has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0516 | Visual system | brand, typography, spacing, color and hierarchy has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0517 | Visual system | brand, typography, spacing, color and hierarchy has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0518 | Visual system | brand, typography, spacing, color and hierarchy has visual and interaction regression coverage. | a packaged UI test. | Remediated alpha.6 |
| WCP-0519 | Visual system | brand, typography, spacing, color and hierarchy has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0520 | Visual system | brand, typography, spacing, color and hierarchy has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0521 | Interaction system | feedback, transitions and reversible actions has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0522 | Interaction system | feedback, transitions and reversible actions makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0523 | Interaction system | feedback, transitions and reversible actions removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0524 | Interaction system | feedback, transitions and reversible actions uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0525 | Interaction system | feedback, transitions and reversible actions provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0526 | Interaction system | feedback, transitions and reversible actions provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0527 | Interaction system | feedback, transitions and reversible actions represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0528 | Interaction system | feedback, transitions and reversible actions uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0529 | Interaction system | feedback, transitions and reversible actions remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0530 | Interaction system | feedback, transitions and reversible actions offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0531 | Interaction system | feedback, transitions and reversible actions supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0532 | Interaction system | feedback, transitions and reversible actions exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0533 | Interaction system | feedback, transitions and reversible actions keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0534 | Interaction system | feedback, transitions and reversible actions meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0535 | Interaction system | feedback, transitions and reversible actions remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0536 | Interaction system | feedback, transitions and reversible actions uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0537 | Interaction system | feedback, transitions and reversible actions works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0538 | Interaction system | feedback, transitions and reversible actions does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0539 | Interaction system | feedback, transitions and reversible actions contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0540 | Interaction system | feedback, transitions and reversible actions handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0541 | Interaction system | feedback, transitions and reversible actions has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0542 | Interaction system | feedback, transitions and reversible actions has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0543 | Interaction system | feedback, transitions and reversible actions has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0544 | Interaction system | feedback, transitions and reversible actions has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0545 | Interaction system | feedback, transitions and reversible actions degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0546 | Interaction system | feedback, transitions and reversible actions shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0547 | Interaction system | feedback, transitions and reversible actions orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0548 | Interaction system | feedback, transitions and reversible actions persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0549 | Interaction system | feedback, transitions and reversible actions is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0550 | Interaction system | feedback, transitions and reversible actions retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0551 | Interaction system | feedback, transitions and reversible actions uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0552 | Interaction system | feedback, transitions and reversible actions minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0553 | Interaction system | feedback, transitions and reversible actions never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0554 | Interaction system | feedback, transitions and reversible actions has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0555 | Interaction system | feedback, transitions and reversible actions has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0556 | Interaction system | feedback, transitions and reversible actions has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0557 | Interaction system | feedback, transitions and reversible actions has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0558 | Interaction system | feedback, transitions and reversible actions has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0559 | Interaction system | feedback, transitions and reversible actions has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0560 | Interaction system | feedback, transitions and reversible actions has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0561 | Responsive behavior | desktop, narrow-window and future-mobile layouts has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0562 | Responsive behavior | desktop, narrow-window and future-mobile layouts makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0563 | Responsive behavior | desktop, narrow-window and future-mobile layouts removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0564 | Responsive behavior | desktop, narrow-window and future-mobile layouts uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0565 | Responsive behavior | desktop, narrow-window and future-mobile layouts provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0566 | Responsive behavior | desktop, narrow-window and future-mobile layouts provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0567 | Responsive behavior | desktop, narrow-window and future-mobile layouts represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0568 | Responsive behavior | desktop, narrow-window and future-mobile layouts uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0569 | Responsive behavior | desktop, narrow-window and future-mobile layouts remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0570 | Responsive behavior | desktop, narrow-window and future-mobile layouts offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0571 | Responsive behavior | desktop, narrow-window and future-mobile layouts supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0572 | Responsive behavior | desktop, narrow-window and future-mobile layouts exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0573 | Responsive behavior | desktop, narrow-window and future-mobile layouts keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0574 | Responsive behavior | desktop, narrow-window and future-mobile layouts meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0575 | Responsive behavior | desktop, narrow-window and future-mobile layouts remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0576 | Responsive behavior | desktop, narrow-window and future-mobile layouts uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0577 | Responsive behavior | desktop, narrow-window and future-mobile layouts works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0578 | Responsive behavior | desktop, narrow-window and future-mobile layouts does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0579 | Responsive behavior | desktop, narrow-window and future-mobile layouts contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0580 | Responsive behavior | desktop, narrow-window and future-mobile layouts handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0581 | Responsive behavior | desktop, narrow-window and future-mobile layouts has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0582 | Responsive behavior | desktop, narrow-window and future-mobile layouts has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0583 | Responsive behavior | desktop, narrow-window and future-mobile layouts has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0584 | Responsive behavior | desktop, narrow-window and future-mobile layouts has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0585 | Responsive behavior | desktop, narrow-window and future-mobile layouts degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0586 | Responsive behavior | desktop, narrow-window and future-mobile layouts shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0587 | Responsive behavior | desktop, narrow-window and future-mobile layouts orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0588 | Responsive behavior | desktop, narrow-window and future-mobile layouts persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0589 | Responsive behavior | desktop, narrow-window and future-mobile layouts is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0590 | Responsive behavior | desktop, narrow-window and future-mobile layouts retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0591 | Responsive behavior | desktop, narrow-window and future-mobile layouts uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0592 | Responsive behavior | desktop, narrow-window and future-mobile layouts minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0593 | Responsive behavior | desktop, narrow-window and future-mobile layouts never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0594 | Responsive behavior | desktop, narrow-window and future-mobile layouts has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0595 | Responsive behavior | desktop, narrow-window and future-mobile layouts has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0596 | Responsive behavior | desktop, narrow-window and future-mobile layouts has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0597 | Responsive behavior | desktop, narrow-window and future-mobile layouts has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0598 | Responsive behavior | desktop, narrow-window and future-mobile layouts has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0599 | Responsive behavior | desktop, narrow-window and future-mobile layouts has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0600 | Responsive behavior | desktop, narrow-window and future-mobile layouts has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0601 | Internationalization | English, Hindi, Gujarati and mixed-script use has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0602 | Internationalization | English, Hindi, Gujarati and mixed-script use makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0603 | Internationalization | English, Hindi, Gujarati and mixed-script use removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0604 | Internationalization | English, Hindi, Gujarati and mixed-script use uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0605 | Internationalization | English, Hindi, Gujarati and mixed-script use provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0606 | Internationalization | English, Hindi, Gujarati and mixed-script use provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0607 | Internationalization | English, Hindi, Gujarati and mixed-script use represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0608 | Internationalization | English, Hindi, Gujarati and mixed-script use uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0609 | Internationalization | English, Hindi, Gujarati and mixed-script use remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0610 | Internationalization | English, Hindi, Gujarati and mixed-script use offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0611 | Internationalization | English, Hindi, Gujarati and mixed-script use supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0612 | Internationalization | English, Hindi, Gujarati and mixed-script use exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0613 | Internationalization | English, Hindi, Gujarati and mixed-script use keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0614 | Internationalization | English, Hindi, Gujarati and mixed-script use meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0615 | Internationalization | English, Hindi, Gujarati and mixed-script use remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0616 | Internationalization | English, Hindi, Gujarati and mixed-script use uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0617 | Internationalization | English, Hindi, Gujarati and mixed-script use works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0618 | Internationalization | English, Hindi, Gujarati and mixed-script use does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0619 | Internationalization | English, Hindi, Gujarati and mixed-script use contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0620 | Internationalization | English, Hindi, Gujarati and mixed-script use handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0621 | Internationalization | English, Hindi, Gujarati and mixed-script use has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0622 | Internationalization | English, Hindi, Gujarati and mixed-script use has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0623 | Internationalization | English, Hindi, Gujarati and mixed-script use has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0624 | Internationalization | English, Hindi, Gujarati and mixed-script use has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0625 | Internationalization | English, Hindi, Gujarati and mixed-script use degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0626 | Internationalization | English, Hindi, Gujarati and mixed-script use shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0627 | Internationalization | English, Hindi, Gujarati and mixed-script use orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0628 | Internationalization | English, Hindi, Gujarati and mixed-script use persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0629 | Internationalization | English, Hindi, Gujarati and mixed-script use is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0630 | Internationalization | English, Hindi, Gujarati and mixed-script use retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0631 | Internationalization | English, Hindi, Gujarati and mixed-script use uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0632 | Internationalization | English, Hindi, Gujarati and mixed-script use minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0633 | Internationalization | English, Hindi, Gujarati and mixed-script use never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0634 | Internationalization | English, Hindi, Gujarati and mixed-script use has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0635 | Internationalization | English, Hindi, Gujarati and mixed-script use has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0636 | Internationalization | English, Hindi, Gujarati and mixed-script use has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0637 | Internationalization | English, Hindi, Gujarati and mixed-script use has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0638 | Internationalization | English, Hindi, Gujarati and mixed-script use has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0639 | Internationalization | English, Hindi, Gujarati and mixed-script use has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0640 | Internationalization | English, Hindi, Gujarati and mixed-script use has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0641 | Runtime performance | startup, rendering, input and model responsiveness has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0642 | Runtime performance | startup, rendering, input and model responsiveness makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0643 | Runtime performance | startup, rendering, input and model responsiveness removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0644 | Runtime performance | startup, rendering, input and model responsiveness uses a safe and useful default. | a default-state test. | Remediated alpha.6 |
| WCP-0645 | Runtime performance | startup, rendering, input and model responsiveness provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0646 | Runtime performance | startup, rendering, input and model responsiveness provides a non-blocking loading state. | a throttled-load test. | Remediated alpha.6 |
| WCP-0647 | Runtime performance | startup, rendering, input and model responsiveness represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0648 | Runtime performance | startup, rendering, input and model responsiveness uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0649 | Runtime performance | startup, rendering, input and model responsiveness remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0650 | Runtime performance | startup, rendering, input and model responsiveness offers one obvious recovery action that preserves work. | a recovery-flow test. | Remediated alpha.6 |
| WCP-0651 | Runtime performance | startup, rendering, input and model responsiveness supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0652 | Runtime performance | startup, rendering, input and model responsiveness exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0653 | Runtime performance | startup, rendering, input and model responsiveness keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0654 | Runtime performance | startup, rendering, input and model responsiveness meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0655 | Runtime performance | startup, rendering, input and model responsiveness remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0656 | Runtime performance | startup, rendering, input and model responsiveness uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0657 | Runtime performance | startup, rendering, input and model responsiveness works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0658 | Runtime performance | startup, rendering, input and model responsiveness does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0659 | Runtime performance | startup, rendering, input and model responsiveness contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Remediated alpha.6 |
| WCP-0660 | Runtime performance | startup, rendering, input and model responsiveness handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0661 | Runtime performance | startup, rendering, input and model responsiveness has a measurable latency budget. | a percentile performance measurement. | Remediated alpha.6 |
| WCP-0662 | Runtime performance | startup, rendering, input and model responsiveness has a measurable memory budget. | a sustained-session memory measurement. | Remediated alpha.6 |
| WCP-0663 | Runtime performance | startup, rendering, input and model responsiveness has a measurable disk budget and retention policy. | a before-and-after storage report. | Remediated alpha.6 |
| WCP-0664 | Runtime performance | startup, rendering, input and model responsiveness has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0665 | Runtime performance | startup, rendering, input and model responsiveness degrades safely when an optional dependency is absent. | a dependency-failure test. | Remediated alpha.6 |
| WCP-0666 | Runtime performance | startup, rendering, input and model responsiveness shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0667 | Runtime performance | startup, rendering, input and model responsiveness orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0668 | Runtime performance | startup, rendering, input and model responsiveness persists only intentional user state. | a restart and reload test. | Remediated alpha.6 |
| WCP-0669 | Runtime performance | startup, rendering, input and model responsiveness is idempotent under retry and duplicate events. | a duplicate/retry test. | Remediated alpha.6 |
| WCP-0670 | Runtime performance | startup, rendering, input and model responsiveness retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0671 | Runtime performance | startup, rendering, input and model responsiveness uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0672 | Runtime performance | startup, rendering, input and model responsiveness minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0673 | Runtime performance | startup, rendering, input and model responsiveness never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0674 | Runtime performance | startup, rendering, input and model responsiveness has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0675 | Runtime performance | startup, rendering, input and model responsiveness has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0676 | Runtime performance | startup, rendering, input and model responsiveness has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0677 | Runtime performance | startup, rendering, input and model responsiveness has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0678 | Runtime performance | startup, rendering, input and model responsiveness has visual and interaction regression coverage. | a packaged UI test. | Remediated alpha.6 |
| WCP-0679 | Runtime performance | startup, rendering, input and model responsiveness has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0680 | Runtime performance | startup, rendering, input and model responsiveness has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0681 | Storage efficiency | message, media, cache and journal storage has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0682 | Storage efficiency | message, media, cache and journal storage makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0683 | Storage efficiency | message, media, cache and journal storage removes actions and copy that do not change the outcome. | a redundancy review. | Remediated alpha.6 |
| WCP-0684 | Storage efficiency | message, media, cache and journal storage uses a safe and useful default. | a default-state test. | Remediated alpha.6 |
| WCP-0685 | Storage efficiency | message, media, cache and journal storage provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0686 | Storage efficiency | message, media, cache and journal storage provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0687 | Storage efficiency | message, media, cache and journal storage represents partial data without implying completeness. | a partial-data fixture. | Remediated alpha.6 |
| WCP-0688 | Storage efficiency | message, media, cache and journal storage uses plain-language errors without exposing internals. | an error-copy test. | Remediated alpha.6 |
| WCP-0689 | Storage efficiency | message, media, cache and journal storage remains truthful and useful while offline. | an offline test. | Remediated alpha.6 |
| WCP-0690 | Storage efficiency | message, media, cache and journal storage offers one obvious recovery action that preserves work. | a recovery-flow test. | Remediated alpha.6 |
| WCP-0691 | Storage efficiency | message, media, cache and journal storage supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0692 | Storage efficiency | message, media, cache and journal storage exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0693 | Storage efficiency | message, media, cache and journal storage keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0694 | Storage efficiency | message, media, cache and journal storage meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0695 | Storage efficiency | message, media, cache and journal storage remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0696 | Storage efficiency | message, media, cache and journal storage uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0697 | Storage efficiency | message, media, cache and journal storage works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0698 | Storage efficiency | message, media, cache and journal storage does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0699 | Storage efficiency | message, media, cache and journal storage contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0700 | Storage efficiency | message, media, cache and journal storage handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0701 | Storage efficiency | message, media, cache and journal storage has a measurable latency budget. | a percentile performance measurement. | Remediated alpha.6 |
| WCP-0702 | Storage efficiency | message, media, cache and journal storage has a measurable memory budget. | a sustained-session memory measurement. | Remediated alpha.6 |
| WCP-0703 | Storage efficiency | message, media, cache and journal storage has a measurable disk budget and retention policy. | a before-and-after storage report. | Remediated alpha.6 |
| WCP-0704 | Storage efficiency | message, media, cache and journal storage has a measurable network and model-token budget. | a request-volume measurement. | Remediated alpha.6 |
| WCP-0705 | Storage efficiency | message, media, cache and journal storage degrades safely when an optional dependency is absent. | a dependency-failure test. | Remediated alpha.6 |
| WCP-0706 | Storage efficiency | message, media, cache and journal storage shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0707 | Storage efficiency | message, media, cache and journal storage orders records deterministically. | an equal-timestamp and replay test. | Remediated alpha.6 |
| WCP-0708 | Storage efficiency | message, media, cache and journal storage persists only intentional user state. | a restart and reload test. | Remediated alpha.6 |
| WCP-0709 | Storage efficiency | message, media, cache and journal storage is idempotent under retry and duplicate events. | a duplicate/retry test. | Remediated alpha.6 |
| WCP-0710 | Storage efficiency | message, media, cache and journal storage retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Remediated alpha.6 |
| WCP-0711 | Storage efficiency | message, media, cache and journal storage uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0712 | Storage efficiency | message, media, cache and journal storage minimizes retained and transmitted personal data. | a data-flow inventory. | Remediated alpha.6 |
| WCP-0713 | Storage efficiency | message, media, cache and journal storage never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0714 | Storage efficiency | message, media, cache and journal storage has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0715 | Storage efficiency | message, media, cache and journal storage has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0716 | Storage efficiency | message, media, cache and journal storage has deterministic unit coverage for its rules. | a unit-test reference. | Remediated alpha.6 |
| WCP-0717 | Storage efficiency | message, media, cache and journal storage has integration coverage across its real boundaries. | an integration-test reference. | Remediated alpha.6 |
| WCP-0718 | Storage efficiency | message, media, cache and journal storage has visual and interaction regression coverage. | a packaged UI test. | Remediated alpha.6 |
| WCP-0719 | Storage efficiency | message, media, cache and journal storage has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0720 | Storage efficiency | message, media, cache and journal storage has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0721 | Sync and data integrity | latest-message, chronology and history coverage has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0722 | Sync and data integrity | latest-message, chronology and history coverage makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0723 | Sync and data integrity | latest-message, chronology and history coverage removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0724 | Sync and data integrity | latest-message, chronology and history coverage uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0725 | Sync and data integrity | latest-message, chronology and history coverage provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0726 | Sync and data integrity | latest-message, chronology and history coverage provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0727 | Sync and data integrity | latest-message, chronology and history coverage represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0728 | Sync and data integrity | latest-message, chronology and history coverage uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0729 | Sync and data integrity | latest-message, chronology and history coverage remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0730 | Sync and data integrity | latest-message, chronology and history coverage offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0731 | Sync and data integrity | latest-message, chronology and history coverage supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0732 | Sync and data integrity | latest-message, chronology and history coverage exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0733 | Sync and data integrity | latest-message, chronology and history coverage keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0734 | Sync and data integrity | latest-message, chronology and history coverage meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0735 | Sync and data integrity | latest-message, chronology and history coverage remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0736 | Sync and data integrity | latest-message, chronology and history coverage uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0737 | Sync and data integrity | latest-message, chronology and history coverage works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0738 | Sync and data integrity | latest-message, chronology and history coverage does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0739 | Sync and data integrity | latest-message, chronology and history coverage contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0740 | Sync and data integrity | latest-message, chronology and history coverage handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0741 | Sync and data integrity | latest-message, chronology and history coverage has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0742 | Sync and data integrity | latest-message, chronology and history coverage has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0743 | Sync and data integrity | latest-message, chronology and history coverage has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0744 | Sync and data integrity | latest-message, chronology and history coverage has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0745 | Sync and data integrity | latest-message, chronology and history coverage degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0746 | Sync and data integrity | latest-message, chronology and history coverage shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0747 | Sync and data integrity | latest-message, chronology and history coverage orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0748 | Sync and data integrity | latest-message, chronology and history coverage persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0749 | Sync and data integrity | latest-message, chronology and history coverage is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0750 | Sync and data integrity | latest-message, chronology and history coverage retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0751 | Sync and data integrity | latest-message, chronology and history coverage uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0752 | Sync and data integrity | latest-message, chronology and history coverage minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0753 | Sync and data integrity | latest-message, chronology and history coverage never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0754 | Sync and data integrity | latest-message, chronology and history coverage has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0755 | Sync and data integrity | latest-message, chronology and history coverage has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0756 | Sync and data integrity | latest-message, chronology and history coverage has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0757 | Sync and data integrity | latest-message, chronology and history coverage has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0758 | Sync and data integrity | latest-message, chronology and history coverage has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0759 | Sync and data integrity | latest-message, chronology and history coverage has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0760 | Sync and data integrity | latest-message, chronology and history coverage has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0761 | AI and tone quality | reply necessity, factuality and person-specific voice has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0762 | AI and tone quality | reply necessity, factuality and person-specific voice makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0763 | AI and tone quality | reply necessity, factuality and person-specific voice removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0764 | AI and tone quality | reply necessity, factuality and person-specific voice uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0765 | AI and tone quality | reply necessity, factuality and person-specific voice provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0766 | AI and tone quality | reply necessity, factuality and person-specific voice provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0767 | AI and tone quality | reply necessity, factuality and person-specific voice represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0768 | AI and tone quality | reply necessity, factuality and person-specific voice uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0769 | AI and tone quality | reply necessity, factuality and person-specific voice remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0770 | AI and tone quality | reply necessity, factuality and person-specific voice offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0771 | AI and tone quality | reply necessity, factuality and person-specific voice supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0772 | AI and tone quality | reply necessity, factuality and person-specific voice exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0773 | AI and tone quality | reply necessity, factuality and person-specific voice keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0774 | AI and tone quality | reply necessity, factuality and person-specific voice meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0775 | AI and tone quality | reply necessity, factuality and person-specific voice remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0776 | AI and tone quality | reply necessity, factuality and person-specific voice uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0777 | AI and tone quality | reply necessity, factuality and person-specific voice works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0778 | AI and tone quality | reply necessity, factuality and person-specific voice does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0779 | AI and tone quality | reply necessity, factuality and person-specific voice contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0780 | AI and tone quality | reply necessity, factuality and person-specific voice handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0781 | AI and tone quality | reply necessity, factuality and person-specific voice has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0782 | AI and tone quality | reply necessity, factuality and person-specific voice has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0783 | AI and tone quality | reply necessity, factuality and person-specific voice has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0784 | AI and tone quality | reply necessity, factuality and person-specific voice has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0785 | AI and tone quality | reply necessity, factuality and person-specific voice degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0786 | AI and tone quality | reply necessity, factuality and person-specific voice shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0787 | AI and tone quality | reply necessity, factuality and person-specific voice orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0788 | AI and tone quality | reply necessity, factuality and person-specific voice persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0789 | AI and tone quality | reply necessity, factuality and person-specific voice is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0790 | AI and tone quality | reply necessity, factuality and person-specific voice retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0791 | AI and tone quality | reply necessity, factuality and person-specific voice uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0792 | AI and tone quality | reply necessity, factuality and person-specific voice minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0793 | AI and tone quality | reply necessity, factuality and person-specific voice never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0794 | AI and tone quality | reply necessity, factuality and person-specific voice has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0795 | AI and tone quality | reply necessity, factuality and person-specific voice has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0796 | AI and tone quality | reply necessity, factuality and person-specific voice has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0797 | AI and tone quality | reply necessity, factuality and person-specific voice has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0798 | AI and tone quality | reply necessity, factuality and person-specific voice has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0799 | AI and tone quality | reply necessity, factuality and person-specific voice has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0800 | AI and tone quality | reply necessity, factuality and person-specific voice has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0801 | Privacy and security | local data, authorization and outbound safety has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0802 | Privacy and security | local data, authorization and outbound safety makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0803 | Privacy and security | local data, authorization and outbound safety removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0804 | Privacy and security | local data, authorization and outbound safety uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0805 | Privacy and security | local data, authorization and outbound safety provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0806 | Privacy and security | local data, authorization and outbound safety provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0807 | Privacy and security | local data, authorization and outbound safety represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0808 | Privacy and security | local data, authorization and outbound safety uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0809 | Privacy and security | local data, authorization and outbound safety remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0810 | Privacy and security | local data, authorization and outbound safety offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0811 | Privacy and security | local data, authorization and outbound safety supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0812 | Privacy and security | local data, authorization and outbound safety exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0813 | Privacy and security | local data, authorization and outbound safety keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0814 | Privacy and security | local data, authorization and outbound safety meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0815 | Privacy and security | local data, authorization and outbound safety remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0816 | Privacy and security | local data, authorization and outbound safety uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0817 | Privacy and security | local data, authorization and outbound safety works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0818 | Privacy and security | local data, authorization and outbound safety does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0819 | Privacy and security | local data, authorization and outbound safety contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0820 | Privacy and security | local data, authorization and outbound safety handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0821 | Privacy and security | local data, authorization and outbound safety has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0822 | Privacy and security | local data, authorization and outbound safety has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0823 | Privacy and security | local data, authorization and outbound safety has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0824 | Privacy and security | local data, authorization and outbound safety has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0825 | Privacy and security | local data, authorization and outbound safety degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0826 | Privacy and security | local data, authorization and outbound safety shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0827 | Privacy and security | local data, authorization and outbound safety orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0828 | Privacy and security | local data, authorization and outbound safety persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0829 | Privacy and security | local data, authorization and outbound safety is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0830 | Privacy and security | local data, authorization and outbound safety retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0831 | Privacy and security | local data, authorization and outbound safety uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0832 | Privacy and security | local data, authorization and outbound safety minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0833 | Privacy and security | local data, authorization and outbound safety never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0834 | Privacy and security | local data, authorization and outbound safety has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0835 | Privacy and security | local data, authorization and outbound safety has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0836 | Privacy and security | local data, authorization and outbound safety has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0837 | Privacy and security | local data, authorization and outbound safety has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0838 | Privacy and security | local data, authorization and outbound safety has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0839 | Privacy and security | local data, authorization and outbound safety has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0840 | Privacy and security | local data, authorization and outbound safety has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0841 | Reliability and recovery | failure isolation, restart and state restoration has one explicit user outcome. | a written acceptance statement. | Foundation implemented |
| WCP-0842 | Reliability and recovery | failure isolation, restart and state restoration makes the primary action immediately discoverable. | a five-second usability check. | Foundation implemented |
| WCP-0843 | Reliability and recovery | failure isolation, restart and state restoration removes actions and copy that do not change the outcome. | a redundancy review. | Foundation implemented |
| WCP-0844 | Reliability and recovery | failure isolation, restart and state restoration uses a safe and useful default. | a default-state test. | Foundation implemented |
| WCP-0845 | Reliability and recovery | failure isolation, restart and state restoration provides a clear empty state. | an empty-fixture screenshot. | Foundation implemented |
| WCP-0846 | Reliability and recovery | failure isolation, restart and state restoration provides a non-blocking loading state. | a throttled-load test. | Foundation implemented |
| WCP-0847 | Reliability and recovery | failure isolation, restart and state restoration represents partial data without implying completeness. | a partial-data fixture. | Foundation implemented |
| WCP-0848 | Reliability and recovery | failure isolation, restart and state restoration uses plain-language errors without exposing internals. | an error-copy test. | Foundation implemented |
| WCP-0849 | Reliability and recovery | failure isolation, restart and state restoration remains truthful and useful while offline. | an offline test. | Foundation implemented |
| WCP-0850 | Reliability and recovery | failure isolation, restart and state restoration offers one obvious recovery action that preserves work. | a recovery-flow test. | Foundation implemented |
| WCP-0851 | Reliability and recovery | failure isolation, restart and state restoration supports a complete keyboard path. | a keyboard-only walkthrough. | Foundation implemented |
| WCP-0852 | Reliability and recovery | failure isolation, restart and state restoration exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Foundation implemented |
| WCP-0853 | Reliability and recovery | failure isolation, restart and state restoration keeps focus visible and returns it after transient UI closes. | a focus-order test. | Foundation implemented |
| WCP-0854 | Reliability and recovery | failure isolation, restart and state restoration meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Foundation implemented |
| WCP-0855 | Reliability and recovery | failure isolation, restart and state restoration remains usable at 200% text scaling. | a text-zoom screenshot. | Foundation implemented |
| WCP-0856 | Reliability and recovery | failure isolation, restart and state restoration uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Foundation implemented |
| WCP-0857 | Reliability and recovery | failure isolation, restart and state restoration works without clipping at its minimum supported viewport. | a viewport matrix. | Foundation implemented |
| WCP-0858 | Reliability and recovery | failure isolation, restart and state restoration does not encode meaning only in color, icon or position. | a multimodal-cue review. | Foundation implemented |
| WCP-0859 | Reliability and recovery | failure isolation, restart and state restoration contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Foundation implemented |
| WCP-0860 | Reliability and recovery | failure isolation, restart and state restoration handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Foundation implemented |
| WCP-0861 | Reliability and recovery | failure isolation, restart and state restoration has a measurable latency budget. | a percentile performance measurement. | Foundation implemented |
| WCP-0862 | Reliability and recovery | failure isolation, restart and state restoration has a measurable memory budget. | a sustained-session memory measurement. | Foundation implemented |
| WCP-0863 | Reliability and recovery | failure isolation, restart and state restoration has a measurable disk budget and retention policy. | a before-and-after storage report. | Foundation implemented |
| WCP-0864 | Reliability and recovery | failure isolation, restart and state restoration has a measurable network and model-token budget. | a request-volume measurement. | Foundation implemented |
| WCP-0865 | Reliability and recovery | failure isolation, restart and state restoration degrades safely when an optional dependency is absent. | a dependency-failure test. | Foundation implemented |
| WCP-0866 | Reliability and recovery | failure isolation, restart and state restoration shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Foundation implemented |
| WCP-0867 | Reliability and recovery | failure isolation, restart and state restoration orders records deterministically. | an equal-timestamp and replay test. | Foundation implemented |
| WCP-0868 | Reliability and recovery | failure isolation, restart and state restoration persists only intentional user state. | a restart and reload test. | Foundation implemented |
| WCP-0869 | Reliability and recovery | failure isolation, restart and state restoration is idempotent under retry and duplicate events. | a duplicate/retry test. | Foundation implemented |
| WCP-0870 | Reliability and recovery | failure isolation, restart and state restoration retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Foundation implemented |
| WCP-0871 | Reliability and recovery | failure isolation, restart and state restoration uses least privilege and denies unneeded permissions. | a capability and permission review. | Foundation implemented |
| WCP-0872 | Reliability and recovery | failure isolation, restart and state restoration minimizes retained and transmitted personal data. | a data-flow inventory. | Foundation implemented |
| WCP-0873 | Reliability and recovery | failure isolation, restart and state restoration never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Foundation implemented |
| WCP-0874 | Reliability and recovery | failure isolation, restart and state restoration has documented threats and mitigations. | a reviewed threat-model entry. | Foundation implemented |
| WCP-0875 | Reliability and recovery | failure isolation, restart and state restoration has documented misuse and abuse cases. | an abuse-case review. | Foundation implemented |
| WCP-0876 | Reliability and recovery | failure isolation, restart and state restoration has deterministic unit coverage for its rules. | a unit-test reference. | Foundation implemented |
| WCP-0877 | Reliability and recovery | failure isolation, restart and state restoration has integration coverage across its real boundaries. | an integration-test reference. | Foundation implemented |
| WCP-0878 | Reliability and recovery | failure isolation, restart and state restoration has visual and interaction regression coverage. | a packaged UI test. | Foundation implemented |
| WCP-0879 | Reliability and recovery | failure isolation, restart and state restoration has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0880 | Reliability and recovery | failure isolation, restart and state restoration has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0881 | Observability and support | diagnostics, metrics and user support has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0882 | Observability and support | diagnostics, metrics and user support makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0883 | Observability and support | diagnostics, metrics and user support removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0884 | Observability and support | diagnostics, metrics and user support uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0885 | Observability and support | diagnostics, metrics and user support provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0886 | Observability and support | diagnostics, metrics and user support provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0887 | Observability and support | diagnostics, metrics and user support represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0888 | Observability and support | diagnostics, metrics and user support uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0889 | Observability and support | diagnostics, metrics and user support remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0890 | Observability and support | diagnostics, metrics and user support offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0891 | Observability and support | diagnostics, metrics and user support supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0892 | Observability and support | diagnostics, metrics and user support exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0893 | Observability and support | diagnostics, metrics and user support keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0894 | Observability and support | diagnostics, metrics and user support meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0895 | Observability and support | diagnostics, metrics and user support remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0896 | Observability and support | diagnostics, metrics and user support uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0897 | Observability and support | diagnostics, metrics and user support works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0898 | Observability and support | diagnostics, metrics and user support does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0899 | Observability and support | diagnostics, metrics and user support contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0900 | Observability and support | diagnostics, metrics and user support handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0901 | Observability and support | diagnostics, metrics and user support has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0902 | Observability and support | diagnostics, metrics and user support has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0903 | Observability and support | diagnostics, metrics and user support has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0904 | Observability and support | diagnostics, metrics and user support has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0905 | Observability and support | diagnostics, metrics and user support degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0906 | Observability and support | diagnostics, metrics and user support shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0907 | Observability and support | diagnostics, metrics and user support orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0908 | Observability and support | diagnostics, metrics and user support persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0909 | Observability and support | diagnostics, metrics and user support is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0910 | Observability and support | diagnostics, metrics and user support retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0911 | Observability and support | diagnostics, metrics and user support uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0912 | Observability and support | diagnostics, metrics and user support minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0913 | Observability and support | diagnostics, metrics and user support never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0914 | Observability and support | diagnostics, metrics and user support has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0915 | Observability and support | diagnostics, metrics and user support has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0916 | Observability and support | diagnostics, metrics and user support has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0917 | Observability and support | diagnostics, metrics and user support has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0918 | Observability and support | diagnostics, metrics and user support has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0919 | Observability and support | diagnostics, metrics and user support has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0920 | Observability and support | diagnostics, metrics and user support has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0921 | Packaging and updates | distribution, signing, upgrading and rollback has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0922 | Packaging and updates | distribution, signing, upgrading and rollback makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0923 | Packaging and updates | distribution, signing, upgrading and rollback removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0924 | Packaging and updates | distribution, signing, upgrading and rollback uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0925 | Packaging and updates | distribution, signing, upgrading and rollback provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0926 | Packaging and updates | distribution, signing, upgrading and rollback provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0927 | Packaging and updates | distribution, signing, upgrading and rollback represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0928 | Packaging and updates | distribution, signing, upgrading and rollback uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0929 | Packaging and updates | distribution, signing, upgrading and rollback remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0930 | Packaging and updates | distribution, signing, upgrading and rollback offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0931 | Packaging and updates | distribution, signing, upgrading and rollback supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0932 | Packaging and updates | distribution, signing, upgrading and rollback exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0933 | Packaging and updates | distribution, signing, upgrading and rollback keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0934 | Packaging and updates | distribution, signing, upgrading and rollback meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0935 | Packaging and updates | distribution, signing, upgrading and rollback remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0936 | Packaging and updates | distribution, signing, upgrading and rollback uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0937 | Packaging and updates | distribution, signing, upgrading and rollback works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0938 | Packaging and updates | distribution, signing, upgrading and rollback does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0939 | Packaging and updates | distribution, signing, upgrading and rollback contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0940 | Packaging and updates | distribution, signing, upgrading and rollback handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0941 | Packaging and updates | distribution, signing, upgrading and rollback has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0942 | Packaging and updates | distribution, signing, upgrading and rollback has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0943 | Packaging and updates | distribution, signing, upgrading and rollback has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0944 | Packaging and updates | distribution, signing, upgrading and rollback has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0945 | Packaging and updates | distribution, signing, upgrading and rollback degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0946 | Packaging and updates | distribution, signing, upgrading and rollback shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0947 | Packaging and updates | distribution, signing, upgrading and rollback orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0948 | Packaging and updates | distribution, signing, upgrading and rollback persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0949 | Packaging and updates | distribution, signing, upgrading and rollback is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0950 | Packaging and updates | distribution, signing, upgrading and rollback retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0951 | Packaging and updates | distribution, signing, upgrading and rollback uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0952 | Packaging and updates | distribution, signing, upgrading and rollback minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0953 | Packaging and updates | distribution, signing, upgrading and rollback never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0954 | Packaging and updates | distribution, signing, upgrading and rollback has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0955 | Packaging and updates | distribution, signing, upgrading and rollback has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0956 | Packaging and updates | distribution, signing, upgrading and rollback has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0957 | Packaging and updates | distribution, signing, upgrading and rollback has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0958 | Packaging and updates | distribution, signing, upgrading and rollback has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0959 | Packaging and updates | distribution, signing, upgrading and rollback has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-0960 | Packaging and updates | distribution, signing, upgrading and rollback has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |
| WCP-0961 | Operations and governance | ownership, compliance and release control has one explicit user outcome. | a written acceptance statement. | Release evidence required |
| WCP-0962 | Operations and governance | ownership, compliance and release control makes the primary action immediately discoverable. | a five-second usability check. | Release evidence required |
| WCP-0963 | Operations and governance | ownership, compliance and release control removes actions and copy that do not change the outcome. | a redundancy review. | Release evidence required |
| WCP-0964 | Operations and governance | ownership, compliance and release control uses a safe and useful default. | a default-state test. | Release evidence required |
| WCP-0965 | Operations and governance | ownership, compliance and release control provides a clear empty state. | an empty-fixture screenshot. | Release evidence required |
| WCP-0966 | Operations and governance | ownership, compliance and release control provides a non-blocking loading state. | a throttled-load test. | Release evidence required |
| WCP-0967 | Operations and governance | ownership, compliance and release control represents partial data without implying completeness. | a partial-data fixture. | Release evidence required |
| WCP-0968 | Operations and governance | ownership, compliance and release control uses plain-language errors without exposing internals. | an error-copy test. | Release evidence required |
| WCP-0969 | Operations and governance | ownership, compliance and release control remains truthful and useful while offline. | an offline test. | Release evidence required |
| WCP-0970 | Operations and governance | ownership, compliance and release control offers one obvious recovery action that preserves work. | a recovery-flow test. | Release evidence required |
| WCP-0971 | Operations and governance | ownership, compliance and release control supports a complete keyboard path. | a keyboard-only walkthrough. | Release evidence required |
| WCP-0972 | Operations and governance | ownership, compliance and release control exposes names, roles, states and counts to assistive technology. | an accessibility-tree assertion. | Release evidence required |
| WCP-0973 | Operations and governance | ownership, compliance and release control keeps focus visible and returns it after transient UI closes. | a focus-order test. | Release evidence required |
| WCP-0974 | Operations and governance | ownership, compliance and release control meets WCAG AA color contrast in every state. | an automated and human contrast audit. | Release evidence required |
| WCP-0975 | Operations and governance | ownership, compliance and release control remains usable at 200% text scaling. | a text-zoom screenshot. | Release evidence required |
| WCP-0976 | Operations and governance | ownership, compliance and release control uses pointer targets of at least 44 by 44 CSS pixels where practical. | a target-size audit. | Release evidence required |
| WCP-0977 | Operations and governance | ownership, compliance and release control works without clipping at its minimum supported viewport. | a viewport matrix. | Release evidence required |
| WCP-0978 | Operations and governance | ownership, compliance and release control does not encode meaning only in color, icon or position. | a multimodal-cue review. | Release evidence required |
| WCP-0979 | Operations and governance | ownership, compliance and release control contains long names, URLs and translated text without overflow. | an adversarial-content fixture. | Release evidence required |
| WCP-0980 | Operations and governance | ownership, compliance and release control handles bidirectional and mixed-script text without changing the source. | a bidi and mixed-script fixture. | Release evidence required |
| WCP-0981 | Operations and governance | ownership, compliance and release control has a measurable latency budget. | a percentile performance measurement. | Release evidence required |
| WCP-0982 | Operations and governance | ownership, compliance and release control has a measurable memory budget. | a sustained-session memory measurement. | Release evidence required |
| WCP-0983 | Operations and governance | ownership, compliance and release control has a measurable disk budget and retention policy. | a before-and-after storage report. | Release evidence required |
| WCP-0984 | Operations and governance | ownership, compliance and release control has a measurable network and model-token budget. | a request-volume measurement. | Release evidence required |
| WCP-0985 | Operations and governance | ownership, compliance and release control degrades safely when an optional dependency is absent. | a dependency-failure test. | Release evidence required |
| WCP-0986 | Operations and governance | ownership, compliance and release control shows freshness using verified source evidence. | a controlled newest-item reconciliation. | Release evidence required |
| WCP-0987 | Operations and governance | ownership, compliance and release control orders records deterministically. | an equal-timestamp and replay test. | Release evidence required |
| WCP-0988 | Operations and governance | ownership, compliance and release control persists only intentional user state. | a restart and reload test. | Release evidence required |
| WCP-0989 | Operations and governance | ownership, compliance and release control is idempotent under retry and duplicate events. | a duplicate/retry test. | Release evidence required |
| WCP-0990 | Operations and governance | ownership, compliance and release control retains a privacy-safe audit trail for consequential state changes. | an audit-record assertion. | Release evidence required |
| WCP-0991 | Operations and governance | ownership, compliance and release control uses least privilege and denies unneeded permissions. | a capability and permission review. | Release evidence required |
| WCP-0992 | Operations and governance | ownership, compliance and release control minimizes retained and transmitted personal data. | a data-flow inventory. | Release evidence required |
| WCP-0993 | Operations and governance | ownership, compliance and release control never exposes secrets, credentials or one-time codes. | a credential-leakage suite. | Release evidence required |
| WCP-0994 | Operations and governance | ownership, compliance and release control has documented threats and mitigations. | a reviewed threat-model entry. | Release evidence required |
| WCP-0995 | Operations and governance | ownership, compliance and release control has documented misuse and abuse cases. | an abuse-case review. | Release evidence required |
| WCP-0996 | Operations and governance | ownership, compliance and release control has deterministic unit coverage for its rules. | a unit-test reference. | Release evidence required |
| WCP-0997 | Operations and governance | ownership, compliance and release control has integration coverage across its real boundaries. | an integration-test reference. | Release evidence required |
| WCP-0998 | Operations and governance | ownership, compliance and release control has visual and interaction regression coverage. | a packaged UI test. | Release evidence required |
| WCP-0999 | Operations and governance | ownership, compliance and release control has load, soak and recovery coverage at the release scale. | a performance/recovery report. | Release evidence required |
| WCP-1000 | Operations and governance | ownership, compliance and release control has a named owner, success metric and fail-closed release gate. | an accountable release record. | Release evidence required |

## Release interpretation

A production claim requires exact-build evidence for every applicable criterion, documented non-applicability for the rest, and independent approval for security, privacy, accessibility, legal and operational gates. Automated tests alone are insufficient.
