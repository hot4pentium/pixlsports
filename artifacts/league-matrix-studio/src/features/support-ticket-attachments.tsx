import React, { useEffect, useState } from "react";

type SupportTicketAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number | null;
  status: "processing" | "available" | "unsupported" | "too_large" | "unavailable" | "too_many";
  downloadUrl: string | null;
};

const REJECTED_COPY: Partial<Record<SupportTicketAttachment["status"], string>> = {
  processing: "Saving attachment…",
  unsupported: "This file type is not supported. The email reply was still saved.",
  too_large: "This file is over the 5 MB limit. The email reply was still saved.",
  unavailable: "This file could not be retrieved or saved. The email reply was still saved.",
  too_many: "Only the first 5 attachments can be saved. Extra files were not saved.",
};

function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024 / 1024 >= 1 ? size / 1024 / 1024 : size / 1024).toFixed(1)} ${size / 1024 / 1024 >= 1 ? "MB" : "KB"}`;
}

function Attachment({ attachment, token }: { attachment: SupportTicketAttachment; token?: string }) {
  const [objectUrl, setObjectUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const view = async () => {
    if (!attachment.downloadUrl || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(attachment.downloadUrl, {
        headers: token ? { "X-Support-Ticket-Token": token } : undefined,
      });
      if (!response.ok) throw new Error("Attachment could not be opened.");
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setObjectUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
    } catch {
      setError("Could not load this attachment. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const statusCopy = REJECTED_COPY[attachment.status];
  if (statusCopy) {
    return (
      <li className="mt-2 break-words rounded border border-current/20 bg-black/5 px-3 py-2 text-xs" role={attachment.status === "processing" ? "status" : "note"}>
        <span className="font-semibold">{attachment.filename}</span>
        <span className="ml-2 opacity-80">{statusCopy}</span>
      </li>
    );
  }

  return (
    <li className="mt-2 break-words rounded border border-current/20 bg-black/5 px-3 py-2 text-xs">
      <span className="font-semibold">{attachment.filename}</span>
      {attachment.size !== null && <span className="ml-2 opacity-70">{formatSize(attachment.size)}</span>}
      {!objectUrl ? (
        <button type="button" onClick={() => void view()} disabled={loading} className="ml-3 underline underline-offset-2 disabled:opacity-60">
          {loading ? "Loading…" : "View attachment"}
        </button>
      ) : attachment.contentType === "application/pdf" ? (
        <a className="ml-3 underline underline-offset-2" href={objectUrl} target="_blank" rel="noreferrer">Open PDF</a>
      ) : (
        <img className="mt-3 max-h-80 max-w-full rounded object-contain" src={objectUrl} alt={attachment.filename} />
      )}
      {error && <p className="mt-2 text-red-700" role="alert">{error}</p>}
    </li>
  );
}

export function SupportTicketAttachments({
  attachments,
  token,
}: {
  attachments?: SupportTicketAttachment[];
  token?: string;
}) {
  if (!attachments?.length) return null;
  return (
    <React.Fragment>
      <ul aria-label="Message attachments" className="mt-2 space-y-2">
        {attachments.map((attachment) => <Attachment key={attachment.id} attachment={attachment} token={token} />)}
      </ul>
    </React.Fragment>
  );
}
