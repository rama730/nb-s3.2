export function buildMessageAttachmentAccessUrl(
  attachmentId: string,
  input?: { download?: boolean },
) {
  const encodedAttachmentId = encodeURIComponent(attachmentId);
  const query = new URLSearchParams();
  if (input?.download) {
    query.set("download", "1");
  }
  const serializedQuery = query.toString();
  return serializedQuery
    ? `/api/v1/messages/attachments/${encodedAttachmentId}?${serializedQuery}`
    : `/api/v1/messages/attachments/${encodedAttachmentId}`;
}
