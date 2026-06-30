export const DOC_COLLABORATION_DOCUMENT_PREFIX = "project-readme-";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildDocCollaborationDocumentName(projectId: string, docSlug: string = "readme") {
  return `${DOC_COLLABORATION_DOCUMENT_PREFIX}${projectId}:${docSlug}`;
}

export function parseDocCollaborationDocumentName(documentName: string) {
  if (!documentName.startsWith(DOC_COLLABORATION_DOCUMENT_PREFIX)) {
    return null;
  }
  const slice = documentName.slice(DOC_COLLABORATION_DOCUMENT_PREFIX.length);
  const parts = slice.split(":");
  const projectId = parts[0] || "";
  const docSlug = parts[1] || "readme";
  return UUID_RE.test(projectId) ? { projectId, docSlug } : null;
}

export function isDocCollaborationDocumentName(documentName: string) {
  return parseDocCollaborationDocumentName(documentName) !== null;
}
