const EDIT_PLACEHOLDER = /\[(?:add|confirm|enter|replace|say|select|write)\b[^\]\r\n]{0,120}\]|\{\{(?:date|time)\}\}/giu;

export function unresolvedComposerPlaceholders(text) {
  return [...String(text || "").matchAll(EDIT_PLACEHOLDER)].map((match) => match[0]);
}

export function composerSendState(text) {
  const body = String(text || "");
  const unresolved = unresolvedComposerPlaceholders(body);
  return {
    body,
    hasText: Boolean(body.trim()),
    unresolved,
    canSend: Boolean(body.trim()) && unresolved.length === 0,
  };
}
