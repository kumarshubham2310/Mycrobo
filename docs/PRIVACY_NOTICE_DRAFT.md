# MyCrobo privacy notice — counsel-review draft

This draft describes the implemented product behavior and must be reviewed for each operating entity, country, connector, hosting region and model provider before use as a legal notice.

## What MyCrobo processes

MyCrobo processes conversation identifiers, participants, message content, timestamps, speaker direction, edits/deletions, reactions, call events, attachment metadata and locally fetched media needed to display conversation history and recommend replies. It also derives conversation state, relationship-specific communication patterns, reply-necessity decisions, tasks, follow-ups and draft feedback.

## Where processing occurs

In the desktop pilot, the raw conversation store and attachment cache remain on the user's device. Message and linked-device databases use an encrypted SQLite VFS; MyCrobo metadata is encrypted with authenticated encryption, and the local directory is restricted to the Windows owner and SYSTEM. During one-time migration an existing plaintext database is retained as an explicit recovery source until the certified deletion workflow removes it. Cloud drafting is disabled unless separately configured with explicit model-processing consent. When enabled, only selected story evidence and tone examples needed for that draft are transmitted; the full account database is not sent for each request.

## Sending

MyCrobo does not send automatically. Ordinary startup is read-only. A future authorised send flow must verify the exact conversation, latest source message, recipient and complete edited body and must preserve an audit receipt. A draft, task, notification or import action is never send authority.

## Retention and controls

Message evidence is retained locally to preserve chronology until the user performs a certified account-data deletion or uninstalls according to the published deletion procedure. Re-fetchable full attachment bytes use a bounded cache and may be removed before message evidence. Users can export or reset MyCrobo preferences, conversation-style choices, task decisions and draft feedback from Settings. That reset does not delete WhatsApp history and is labelled accordingly.

## Diagnostics

Operational diagnostics are content-free. They contain an opaque correlation ID, time, route category, method, status and duration. They do not contain message or draft text, contacts, phone numbers, chat IDs, filenames or URLs.

## Business Platform connector

The WhatsApp Business Platform connector receives events from webhook registration onward. It does not import a personal account's earlier history. Meta and the relevant hosting/model providers may be separate processors or controllers as determined by counsel and the applicable contracts.

## User rights and contact

The final notice must identify the operating entity, privacy contact, data-protection officer where required, purposes and lawful bases, retention periods, recipients/subprocessors, international transfers, complaint authority, access/correction/deletion/portability/objection rights, automated-decision explanation, withdrawal of consent, account deletion and appeal paths.

No production release may replace these required identities and jurisdiction-specific terms with placeholders.
