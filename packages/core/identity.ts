export function normalizeConnectorId(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export class CanonicalIdentityIndex {
  #canonicalByConnectorId = new Map<string, string>();

  link(canonicalId: string, connectorIds: string[]) {
    const exactCanonical = canonicalId.trim();
    if (!exactCanonical) throw new Error("Canonical id is required.");
    for (const raw of connectorIds) {
      const connectorId = normalizeConnectorId(raw);
      if (!connectorId) continue;
      const existing = this.#canonicalByConnectorId.get(connectorId);
      if (existing && existing !== exactCanonical) {
        throw new Error(`Connector identity ${connectorId} is already linked to ${existing}.`);
      }
      this.#canonicalByConnectorId.set(connectorId, exactCanonical);
    }
  }

  resolve(connectorId: string) {
    return this.#canonicalByConnectorId.get(normalizeConnectorId(connectorId)) ?? null;
  }
}

export type IdentityEvidence = {
  id: string;
  connectorId: string;
  canonicalPersonId: string;
  source: "connector" | "contact-book" | "user-confirmed" | "group-membership";
  confidence: number;
  observedAt: string;
};

export type AliasEvidence = {
  alias: string;
  canonicalPersonId: string;
  sourceMessageId: string | null;
  confidence: number;
  observedAt: string;
};

/**
 * An evidence-retaining identity graph. It never guesses that two conflicting
 * connector identifiers are the same person; a caller must add explicit
 * evidence, and every resolution remains auditable.
 */
export class EvidenceBackedIdentityGraph {
  #linksByConnectorId = new Map<string, IdentityEvidence[]>();
  #aliasesByPersonId = new Map<string, AliasEvidence[]>();

  addLink(evidence: IdentityEvidence) {
    const connectorId = normalizeConnectorId(evidence.connectorId);
    const canonicalPersonId = evidence.canonicalPersonId.trim();
    if (!evidence.id.trim() || !connectorId || !canonicalPersonId) {
      throw new Error("Identity evidence requires an id, connector id and canonical person id.");
    }
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
      throw new Error("Identity evidence confidence must be between 0 and 1.");
    }
    const existing = this.#linksByConnectorId.get(connectorId) ?? [];
    if (existing.some((item) => item.id === evidence.id)) return;
    const conflictingConfirmed = existing.find((item) =>
      item.canonicalPersonId !== canonicalPersonId
      && (item.source === "user-confirmed" || evidence.source === "user-confirmed"));
    if (conflictingConfirmed) {
      throw new Error(`Connector identity ${connectorId} has conflicting confirmed evidence.`);
    }
    existing.push({ ...evidence, connectorId, canonicalPersonId });
    this.#linksByConnectorId.set(connectorId, existing);
  }

  addAlias(evidence: AliasEvidence) {
    const canonicalPersonId = evidence.canonicalPersonId.trim();
    const alias = evidence.alias.normalize("NFKC").trim();
    if (!canonicalPersonId || !alias) throw new Error("Alias evidence requires a person id and alias.");
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
      throw new Error("Alias evidence confidence must be between 0 and 1.");
    }
    const existing = this.#aliasesByPersonId.get(canonicalPersonId) ?? [];
    if (!existing.some((item) => item.alias.toLocaleLowerCase() === alias.toLocaleLowerCase()
      && item.sourceMessageId === evidence.sourceMessageId)) {
      existing.push({ ...evidence, alias, canonicalPersonId });
      this.#aliasesByPersonId.set(canonicalPersonId, existing);
    }
  }

  resolve(connectorId: string) {
    const normalized = normalizeConnectorId(connectorId);
    const evidence = [...(this.#linksByConnectorId.get(normalized) ?? [])];
    const totals = new Map<string, number>();
    for (const item of evidence) {
      const sourceWeight = item.source === "user-confirmed" ? 4 : item.source === "connector" ? 2 : 1;
      totals.set(item.canonicalPersonId, (totals.get(item.canonicalPersonId) ?? 0) + item.confidence * sourceWeight);
    }
    const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    if (!ranked.length || (ranked[1] && ranked[0][1] === ranked[1][1])) {
      return { canonicalPersonId: null, confidence: 0, evidence };
    }
    const total = ranked.reduce((sum, item) => sum + item[1], 0);
    return {
      canonicalPersonId: ranked[0][0],
      confidence: total ? Number((ranked[0][1] / total).toFixed(4)) : 0,
      evidence,
    };
  }

  aliases(canonicalPersonId: string) {
    return [...(this.#aliasesByPersonId.get(canonicalPersonId.trim()) ?? [])]
      .sort((left, right) => right.confidence - left.confidence || right.observedAt.localeCompare(left.observedAt));
  }
}
