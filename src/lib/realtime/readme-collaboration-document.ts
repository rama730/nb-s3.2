export const README_COLLABORATION_DOCUMENT_PREFIX = "project-readme-";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildReadmeCollaborationDocumentName(projectId: string) {
  return `${README_COLLABORATION_DOCUMENT_PREFIX}${projectId}`;
}

export function parseReadmeCollaborationDocumentName(documentName: string) {
  if (!documentName.startsWith(README_COLLABORATION_DOCUMENT_PREFIX)) {
    return null;
  }
  const projectId = documentName.slice(README_COLLABORATION_DOCUMENT_PREFIX.length);
  return UUID_RE.test(projectId) ? projectId : null;
}

export function isReadmeCollaborationDocumentName(documentName: string) {
  return parseReadmeCollaborationDocumentName(documentName) !== null;
}
