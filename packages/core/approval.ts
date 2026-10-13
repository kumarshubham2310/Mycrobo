export type DraftStatus = "pending" | "approved" | "rejected" | "cancelled";

export type PendingDraft = {
  id: string;
  chatId: string;
  chatTitle: string;
  replyToMessageId: string;
  text: string;
  status: DraftStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolutionRequestId: string | null;
};

export type ApprovedSendEnvelope = {
  draftId: string;
  requestId: string;
  chatId: string;
  exactText: string;
  approvalVersion: "draft-approval.1";
};

export class ApprovalLedger {
  #drafts = new Map<string, PendingDraft>();
  #approved = new Map<string, ApprovedSendEnvelope>();

  create(input: Omit<PendingDraft, "status" | "resolvedAt" | "resolutionRequestId">) {
    if (this.#drafts.has(input.id)) throw new Error(`Draft ${input.id} already exists.`);
    const draft: PendingDraft = { ...input, status: "pending", resolvedAt: null, resolutionRequestId: null };
    this.#drafts.set(draft.id, draft);
    return structuredClone(draft);
  }

  approve(input: {
    draftId: string;
    requestId: string;
    confirmedChatId: string;
    confirmedText: string;
    approvalVersion: "draft-approval.1";
    now: string;
  }): ApprovedSendEnvelope {
    const prior = this.#approved.get(input.requestId);
    if (prior) return structuredClone(prior);
    const draft = this.#drafts.get(input.draftId);
    if (!draft) throw new Error("Draft not found.");
    if (draft.status !== "pending") throw new Error(`Draft is already ${draft.status}.`);
    if (input.approvalVersion !== "draft-approval.1") throw new Error("Unsupported approval version.");
    if (draft.chatId !== input.confirmedChatId || draft.text !== input.confirmedText) {
      throw new Error("The confirmed recipient or text does not exactly match the pending draft.");
    }
    const envelope: ApprovedSendEnvelope = {
      draftId: draft.id,
      requestId: input.requestId,
      chatId: draft.chatId,
      exactText: draft.text,
      approvalVersion: input.approvalVersion,
    };
    draft.status = "approved";
    draft.resolvedAt = input.now;
    draft.resolutionRequestId = input.requestId;
    this.#approved.set(input.requestId, envelope);
    return structuredClone(envelope);
  }

  cancelWhenOwnerReplies(chatId: string, now: string) {
    const cancelled: string[] = [];
    for (const draft of this.#drafts.values()) {
      if (draft.chatId !== chatId || draft.status !== "pending") continue;
      draft.status = "cancelled";
      draft.resolvedAt = now;
      cancelled.push(draft.id);
    }
    return cancelled;
  }
}
