export const PERSONALIZATION_OUTCOMES = ["shown", "accepted", "lightly-edited", "full-rewrite", "dismissed", "no-reply"] as const;
export type PersonalizationOutcome = typeof PERSONALIZATION_OUTCOMES[number];

const OUTCOME_ADJUSTMENT: Record<PersonalizationOutcome, number> = {
  shown: 0,
  accepted: 12,
  "lightly-edited": 6,
  "full-rewrite": -18,
  dismissed: -12,
  "no-reply": -24,
};

function normalize(value: string) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim().slice(0, 2_000);
}

function levenshtein(left: string, right: string) {
  const a = [...left];
  const b = [...right];
  if (a.length > b.length) return levenshtein(right, left);
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let row = 1; row <= b.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= a.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[column - 1] === b[row - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[a.length];
}

/**
 * Compares text transiently and returns content-free learning metadata only.
 * Neither source string is included in the result.
 */
export function classifyDraftEditOutcome(shownDraft: string, finalDraft: string): {
  outcome: "accepted" | "lightly-edited" | "full-rewrite" | "dismissed";
  editRatio: number;
} {
  const shown = normalize(shownDraft);
  const final = normalize(finalDraft);
  if (!final) return { outcome: "dismissed", editRatio: 1 };
  if (shown === final) return { outcome: "accepted", editRatio: 0 };
  const editRatio = Math.min(1, levenshtein(shown, final) / Math.max(1, [...shown].length, [...final].length));
  return { outcome: editRatio <= 0.35 ? "lightly-edited" : "full-rewrite", editRatio: Number(editRatio.toFixed(4)) };
}

export function personalizationOutcomeAdjustment(outcome: PersonalizationOutcome) {
  return OUTCOME_ADJUSTMENT[outcome];
}
