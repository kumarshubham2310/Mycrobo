const LABELS = {
  image: "Photo",
  video: "Video",
  audio: "Audio",
  document: "Document",
  sticker: "Sticker",
  view_once: "View-once media",
  media: "Media",
};

export function mediaPresentation(message) {
  const media = message?.media;
  const category = media?.category || message?.kind || "media";
  const label = LABELS[category] || "Media";
  const mimeType = String(media?.mimeType || "").toLowerCase();
  const fileName = String(media?.fileName || "").trim();
  const viewUrl = String(media?.viewUrl || "").trim();
  const status = media?.status || "metadata_only";
  const fullAvailable = media?.fullAvailable === true || status === "ready";
  const fetchAvailable = media?.fetchAvailable === true;
  const isPDF = category === "document" && (mimeType === "application/pdf" || /\.pdf$/iu.test(fileName));
  const supportedFetch = category === "image" || category === "video" || category === "audio" || isPDF;
  const retryLabel = category === "image" ? "Load full photo" : category === "video" ? "Fetch video" : category === "audio" ? "Fetch audio" : "Fetch PDF";

  if (!media) return { kind: "none", label, canView: false, detail: "" };
  if (category === "view_once" || status === "blocked_view_once") {
    return { kind: "placeholder", label, canView: false, detail: "View-once media stays private to WhatsApp." };
  }
  if (status === "failed") {
    const retryable = supportedFetch && fetchAvailable;
    return { kind: "placeholder", label, canView: false, detail: retryable ? "The previous fetch did not finish. You can try again." : "WhatsApp no longer makes this attachment available.", canRetry: retryable, retryLabel };
  }
  if (category === "image" && viewUrl) {
    return {
      kind: "image",
      label,
      canView: true,
      viewUrl,
      fileName,
      fullAvailable,
      canRetry: !fullAvailable && fetchAvailable && status !== "queued",
      retryLabel,
      detail: fullAvailable ? "Full photo saved locally." : "A private thumbnail is ready. Load the full photo for detail.",
    };
  }
  if (category === "video" && viewUrl && ["video/mp4", "video/webm"].includes(mimeType)) {
    return { kind: "video", label, canView: true, viewUrl, fileName };
  }
  if (category === "audio" && viewUrl && mimeType.startsWith("audio/")) {
    return { kind: "audio", label, canView: true, viewUrl, fileName };
  }
  if (category === "document" && viewUrl && mimeType === "application/pdf") {
    return { kind: "pdf", label: "PDF", canView: true, viewUrl, fileName: fileName || "Document.pdf" };
  }

  const beingFetched = ["thumbnail", "metadata_only", "queued"].includes(status);
  const fetchDetail = status === "queued"
    ? "Fetching this attachment locally. It will become viewable here when ready."
    : "This attachment is not saved for viewing yet.";
  const detail = category === "image"
    ? status === "queued"
      ? "Loading the full photo from WhatsApp."
      : fetchAvailable
        ? "This photo is not saved for viewing yet."
        : "WhatsApp has not provided retrievable photo data for this message."
    : category === "video" || category === "audio" || isPDF
    ? beingFetched
      ? fetchDetail
      : "A safe in-app preview is not available for this file."
    : category === "document"
      ? "This file type is shown as an attachment and is not opened inside MyCrobo."
      : "A preview will appear when WhatsApp makes the attachment available.";
  const canRetry = status !== "queued" && beingFetched && supportedFetch && fetchAvailable;
  return { kind: "placeholder", label, canView: false, detail, pending: beingFetched, fileName, canRetry, retryLabel };
}
