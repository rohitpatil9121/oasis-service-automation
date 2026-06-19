import { BASE, getToken } from "../api/client.js";

// Renders WhatsApp media (image / video / document) inside a chat bubble.
// mediaType is the MIME type, e.g. "image/jpeg", "video/mp4", "application/pdf".
export default function MediaBubble({ mediaId, mediaType, isOutbound }) {
  const url = `${BASE}/api/media/${mediaId}?t=${getToken()}`;
  const type = (mediaType || "").toLowerCase();

  if (type.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        <img
          src={url}
          alt="Image"
          className="max-h-56 w-auto rounded-lg object-contain"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.nextSibling.style.display = "flex";
          }}
        />
        <span style={{ display: "none" }}
          className="inline-flex items-center gap-1 text-xs opacity-70">
          🖼️ Image (tap to open)
        </span>
      </a>
    );
  }

  if (type.startsWith("video/")) {
    return (
      <div className="mb-1">
        <video
          src={url}
          controls
          className="max-h-56 w-full rounded-lg"
          preload="metadata"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.nextSibling.style.display = "flex";
          }}
        />
        <span style={{ display: "none" }}
          className="inline-flex items-center gap-1 text-xs opacity-70">
          🎥 Video —{" "}
          <a href={url} target="_blank" rel="noreferrer"
            className={`underline ${isOutbound ? "text-emerald-100" : "text-brand"}`}>
            open
          </a>
        </span>
      </div>
    );
  }

  // Document / audio / unknown — show a download link.
  const label = type.startsWith("audio/") ? "🎤 Voice message"
    : type === "application/pdf" ? "📄 PDF document"
    : "📎 Attachment";

  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-1 inline-flex items-center gap-1 text-xs underline opacity-80">
      {label}
    </a>
  );
}
