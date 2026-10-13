import { isHumanText, orderedEvents } from "./conversation.ts";
import type { MessageEvent, ToneSample } from "./domain.ts";

const NO_VOICE_SIGNAL = /^(?:https?:\/\/\S+|\d{4,8}|(?:yes|no)\s+\d+|(?:otp|password|code)\b[^]*)$/iu;
const FACT_OR_COMMITMENT_SIGNAL = /(?:[₹$€£¥]|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:aaj|abhi|after lunch|afternoon|before|evening|friday|hours?|kal|later|monday|morning|next (?:week|month)|now|saturday|shaam|soon|subah|sunday|thursday|today|tomorrow|tonight|tuesday|wednesday)\b|\b(?:i(?:'|’)ll|i will|i can|i am going to|we(?:'|’)ll|we will|we can)\b|\b(?:bata|bhej|check|confirm|dekh|janav|kahi|kar|mokli|pahunch|send|update)\s*(?:dais|dunga|dungi|deta|deti|karis|karunga|karungi|lau|lunga|lungi)\b|\b(?:i(?:'|’)m|i am|main|mai)\s+(?:at|in|near|outside|available|free|ghar|home|office)\b)/iu;

export function isSafeLexicalToneExample(text: string) {
  const value = String(text || "").trim();
  return Boolean(value) && !NO_VOICE_SIGNAL.test(value) && !FACT_OR_COMMITMENT_SIGNAL.test(value);
}

export function buildToneSamplePool(options: {
  allEvents: MessageEvent[];
  relationshipChatId?: string;
  nowMs: number;
  maximum?: number;
}) {
  const maximum = Math.max(30, Math.min(50, options.maximum ?? 40));
  const eligible: ToneSample[] = orderedEvents(options.allEvents)
    .filter((event) => event.direction === "owner" && isHumanText(event))
    .filter((event) => event.timestampVerified && event.timestampMs !== null)
    .filter((event) => event.text.length >= 2 && event.text.length <= 300)
    .filter((event) => isSafeLexicalToneExample(event.text))
    .map((event) => ({
      messageId: event.id,
      chatId: event.chatId,
      text: event.text,
      timestampMs: event.timestampMs as number,
      relationshipSpecific: event.chatId === options.relationshipChatId,
    }));
  return eligible
    .map((sample) => ({
      sample,
      score: (sample.relationshipSpecific ? 10_000 : 0)
        + (sample.timestampMs >= options.nowMs - 60 * 24 * 60 * 60 * 1_000 ? 2_000 : 0)
        + sample.timestampMs / 1e13,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maximum)
    .map(({ sample }) => sample);
}
