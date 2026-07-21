import { isUuid } from "@/lib/validations/uuid";

export const DOC_COLLABORATION_DOCUMENT_PREFIX = "project-readme-";

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
  return isUuid(projectId) ? { projectId, docSlug } : null;
}

export function isDocCollaborationDocumentName(documentName: string) {
  return parseDocCollaborationDocumentName(documentName) !== null;
}
