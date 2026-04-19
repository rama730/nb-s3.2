import type { ProjectNode } from "@/lib/db/schema";
import type { TaskWorkflowStatus } from "@/lib/projects/task-workflow";

export type TaskFileIntent =
  | "attach_new"
  | "attach_existing"
  | "replace_existing"
  | "candidate_child_of_linked_folder"
  | "ambiguous"
  /**
   * Wave 3 folder intents. Emitted when `resolveTaskFileIntent` is called
   * with `candidateType === "folder"`. These drive a distinct set of
   * resolution choices (`merge`, `subfolder`, `replace`, `attach_new`)
   * rendered by the FilesTab resolution modal.
   */
  | "folder_replace_existing"
  | "folder_merge_into_existing"
  | "folder_create_subfolder";

export type TaskFileReadiness =
  | "ready"
  | "warning_missing_deliverable"
  | "warning_unresolved_replacement"
  | "warning_unclassified_upload"
  | "warning_only_reference_files";

export type TaskFileResolutionChoice =
  | "replace"
  | "attach_new"
  | "link_existing"
  /** Folder-only: merge dropped contents into an existing linked folder. */
  | "merge"
  /** Folder-only: create a new subfolder under an existing linked folder. */
  | "subfolder"
  | "cancel";

export type TaskFileRole = "reference" | "working" | "deliverable";

export type TaskLinkedNode = {
  id: string;
  name: string;
  type: "file" | "folder";
  path: string | null;
  annotation?: string | null;
};

export type TaskFileIntentResolution = {
  intent: TaskFileIntent;
  confidence: "low" | "medium" | "high";
  requiresPrompt: boolean;
  recommendedChoice: Exclude<TaskFileResolutionChoice, "cancel">;
  matchedNodeId: string | null;
  matchedNodeName: string | null;
  linkedFolderId: string | null;
  linkedFolderName: string | null;
  linkedFolderPath: string | null;
  reason: string;
};

export type TaskFileReadinessWarning = {
  code: Exclude<TaskFileReadiness, "ready">;
  message: string;
};

const REFERENCE_KEYWORDS = [
  "brief",
  "doc",
  "docs",
  "guide",
  "notes",
  "reference",
  "requirements",
  "spec",
  "specs",
];

const DELIVERABLE_KEYWORDS = [
  "answer",
  "deliverable",
  "final",
  "fix",
  "output",
  "patch",
  "report",
  "result",
  "solution",
  "submission",
];

const WORKING_KEYWORDS = [
  "draft",
  "temp",
  "tmp",
  "wip",
  "working",
];

function sanitizeWhitespace(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value: string | null | undefined) {
  return sanitizeWhitespace(value)
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedExtension(value: string | null | undefined) {
  const source = sanitizeWhitespace(value).toLowerCase();
  const parts = source.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * Token-level keyword check.
 *
 * The previous implementation used `text.includes(keyword)`, which
 * silently matched substrings: "doc" lit up on any path containing
 * "Documents", "dock", "docker", or "documentation" — so a file stored
 * under `~/Documents/hello.py` was reliably misclassified as "reference"
 * even though the filename itself had no hint of it.
 *
 * This splits on any non-alphanumeric boundary and checks for equality,
 * so "doc" only matches the bare token "doc" (or "docs" via its own
 * entry in the list).
 */
function hasKeyword(tokens: string[], keywords: string[]) {
  if (tokens.length === 0) return false;
  const tokenSet = new Set(tokens);
  return keywords.some((keyword) => tokenSet.has(keyword));
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    // Strip file extension first so `.py` / `.md` don't leak into tokens.
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function isDescendantPath(folderPath: string | null | undefined, candidatePath: string | null | undefined) {
  const folder = sanitizeWhitespace(folderPath);
  const candidate = sanitizeWhitespace(candidatePath);
  if (!folder || !candidate) return false;
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return candidate.startsWith(prefix);
}

function baseIntentResolution(
  intent: TaskFileIntent,
  overrides: Partial<TaskFileIntentResolution> = {},
): TaskFileIntentResolution {
  return {
    intent,
    confidence: "low",
    requiresPrompt: false,
    recommendedChoice: "attach_new",
    matchedNodeId: null,
    matchedNodeName: null,
    linkedFolderId: null,
    linkedFolderName: null,
    linkedFolderPath: null,
    reason: "",
    ...overrides,
  };
}

export function normalizeTaskTitleDraft(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Heuristic role inference for a linked file or folder.
 *
 * Only the filename and the user-supplied annotation are inspected — the
 * full path used to be part of the haystack too, but parent folder names
 * (e.g. `~/Documents/`, `Notes/`, `docs-archive/`) produced confident
 * false-positives. The annotation is the user's own signal, so we keep it
 * as a strong hint; the name is the primary signal.
 *
 * When nothing matches, we return `"working"` rather than `"deliverable"`.
 * A confident "deliverable" default caused the readiness warning to never
 * fire for truly unclassified files, and the UI chip to claim certainty
 * the heuristic didn't actually have. "Working" is the honest neutral.
 */
export function inferTaskFileRole(node: Pick<TaskLinkedNode, "name" | "type" | "path" | "annotation">): TaskFileRole {
  const nameTokens = tokenize(sanitizeWhitespace(node.name));
  const annotationTokens = tokenize(sanitizeWhitespace(node.annotation));
  const tokens = [...nameTokens, ...annotationTokens];

  // Deliverable wins over reference: the user explicitly labelled it "final",
  // "submission", etc., so that overrides any coincidental "notes" token.
  if (hasKeyword(tokens, DELIVERABLE_KEYWORDS)) return "deliverable";
  if (hasKeyword(tokens, REFERENCE_KEYWORDS)) return "reference";
  if (hasKeyword(tokens, WORKING_KEYWORDS)) return "working";
  if (node.type === "folder") return "working";
  return "working";
}

/**
 * Tasks that are actively being closed — this is the only state where a
 * "readiness" warning is useful. For a fresh `todo`, `in_progress`, or
 * `blocked` task, the user hasn't attempted to ship yet; surfacing
 * "missing deliverable" or "only reference files" is pure noise.
 */
const CLOSING_STATUSES = new Set<TaskWorkflowStatus>(["done"]);

export function buildTaskFileReadinessWarnings(input: {
  status: TaskWorkflowStatus;
  attachments: TaskLinkedNode[];
  unresolvedReplacement?: boolean;
  unclassifiedUpload?: boolean;
}) {
  const warnings: TaskFileReadinessWarning[] = [];
  const attachments = input.attachments ?? [];
  const isClosing = CLOSING_STATUSES.has(input.status);

  // "Missing deliverable" and "only reference files" are both
  // close-the-loop checks. Surfacing them on a todo task is noise —
  // the user hasn't even started yet.
  if (isClosing) {
    if (attachments.length === 0) {
      warnings.push({
        code: "warning_missing_deliverable",
        message:
          "No task files are linked yet, so there is no clear deliverable for this task.",
      });
    } else {
      const roles = attachments.map(inferTaskFileRole);
      const hasDeliverable = roles.includes("deliverable");
      const onlyReference = roles.every((role) => role === "reference");

      if (!hasDeliverable && onlyReference) {
        warnings.push({
          code: "warning_only_reference_files",
          message:
            "Only reference-style files are linked. Add or classify a likely deliverable before closing the loop.",
        });
      }
    }
  }

  // These two are status-agnostic — a stuck replacement or an unclassified
  // upload is always worth surfacing, regardless of task state.
  if (input.unresolvedReplacement) {
    warnings.push({
      code: "warning_unresolved_replacement",
      message: "A file match still needs a replace-or-attach decision.",
    });
  }

  if (input.unclassifiedUpload) {
    warnings.push({
      code: "warning_unclassified_upload",
      message:
        "A recent file action still needs classification before the task feels complete.",
    });
  }

  if (warnings.length === 0) {
    return [{ code: "ready" as const, message: "Task files look ready." }];
  }

  return warnings;
}

export function getTaskFileWarnings(input: {
  status: TaskWorkflowStatus;
  attachments: TaskLinkedNode[];
  unresolvedReplacement?: boolean;
  unclassifiedUpload?: boolean;
}) {
  return buildTaskFileReadinessWarnings(input).filter(
    (warning): warning is TaskFileReadinessWarning => warning.code !== "ready",
  );
}

export function summarizeTaskFileWarnings(warnings: TaskFileReadinessWarning[]) {
  if (warnings.length === 0) return null;
  if (warnings.length === 1) return warnings[0].message;
  return `${warnings.length} file follow-ups need attention before this task feels fully wrapped.`;
}

/**
 * Wave 3: resolve a folder drop against this task's existing attachments.
 *
 * Unlike the file resolver, we don't care about extensions — folder names
 * are normalized to tokens and compared directly. We also accept
 * `candidateChildNames` so we can detect "overlap" for the merge intent
 * without the caller having to walk the tree themselves.
 */
function resolveFolderCandidate(input: {
  candidateName: string;
  candidateChildNames: string[];
  attachments: TaskLinkedNode[];
}): TaskFileIntentResolution {
  const candidateToken = normalizeToken(input.candidateName);
  const linkedFolders = input.attachments.filter((attachment) => attachment.type === "folder");

  // 1. Exact folder-name match → replace-existing recommendation.
  const exactFolderMatch = linkedFolders.find(
    (folder) => normalizeToken(folder.name) === candidateToken,
  );
  if (exactFolderMatch) {
    return baseIntentResolution("folder_replace_existing", {
      confidence: "high",
      requiresPrompt: true,
      recommendedChoice: "replace",
      matchedNodeId: exactFolderMatch.id,
      matchedNodeName: exactFolderMatch.name,
      linkedFolderId: exactFolderMatch.id,
      linkedFolderName: exactFolderMatch.name,
      linkedFolderPath: exactFolderMatch.path,
      reason: `A folder named ${exactFolderMatch.name} is already linked. We can replace its contents, merge, or attach the dropped folder as a new attachment.`,
    });
  }

  // 2. Child-overlap against a linked folder's direct attachments →
  //    suggest merging into that folder. We treat overlap as "the dropped
  //    folder contains at least one filename that appears in the
  //    task's linked file attachments under the same folder context."
  const linkedFileNames = new Set(
    input.attachments
      .filter((attachment) => attachment.type === "file")
      .map((attachment) => normalizeToken(attachment.name)),
  );
  const childOverlapCount = input.candidateChildNames.reduce((count, child) => {
    return linkedFileNames.has(normalizeToken(child)) ? count + 1 : count;
  }, 0);

  if (linkedFolders.length > 0 && childOverlapCount > 0) {
    const target = linkedFolders[0];
    return baseIntentResolution("folder_merge_into_existing", {
      confidence: childOverlapCount >= 2 ? "high" : "medium",
      requiresPrompt: true,
      recommendedChoice: "merge",
      matchedNodeId: target.id,
      matchedNodeName: target.name,
      linkedFolderId: target.id,
      linkedFolderName: target.name,
      linkedFolderPath: target.path,
      reason: `${childOverlapCount} of the dropped folder's files look like updates to files already linked under ${target.name}. We can merge, attach as a subfolder, or attach as a new folder.`,
    });
  }

  // 3. A linked folder exists but no overlap → suggest creating a subfolder.
  if (linkedFolders.length > 0) {
    const target = linkedFolders[0];
    return baseIntentResolution("folder_create_subfolder", {
      confidence: "medium",
      requiresPrompt: true,
      recommendedChoice: "subfolder",
      linkedFolderId: target.id,
      linkedFolderName: target.name,
      linkedFolderPath: target.path,
      reason: `${input.candidateName} doesn't match anything linked yet, but ${target.name} is the task's working folder. Add it as a subfolder, or attach it as a new folder at the task's root.`,
    });
  }

  // 4. Nothing to merge against → plain attach.
  return baseIntentResolution("attach_new", {
    confidence: "low",
    recommendedChoice: "attach_new",
    reason: "No linked folders match this drop — we'll create it as a new folder attached to the task.",
  });
}

export function resolveTaskFileIntent(input: {
  candidateName: string;
  candidateType?: "file" | "folder";
  /**
   * Wave 3: when `candidateType === "folder"`, pass the basenames of the
   * folder's direct file children so we can detect overlap with existing
   * linked files. Extensions are part of the basename.
   */
  candidateChildNames?: string[];
  candidateNode?: Pick<ProjectNode, "id" | "name" | "path" | "type" | "parentId"> | null;
  attachments: TaskLinkedNode[];
  searchMatches?: Pick<ProjectNode, "id" | "name" | "path" | "type" | "parentId">[];
}) {
  const attachments = input.attachments ?? [];

  // Wave 3 — folder branch. Folders don't route through the file
  // extension/descendant logic below; they have their own intent set.
  if (input.candidateType === "folder") {
    return resolveFolderCandidate({
      candidateName: input.candidateName,
      candidateChildNames: input.candidateChildNames ?? [],
      attachments,
    });
  }

  const candidateToken = normalizeToken(input.candidateName);
  const candidateExt = normalizedExtension(input.candidateName);
  const linkedFolders = attachments.filter((attachment) => attachment.type === "folder");
  const directFileMatches = attachments.filter((attachment) => {
    if (attachment.type !== "file") return false;
    return normalizeToken(attachment.name) === candidateToken && normalizedExtension(attachment.name) === candidateExt;
  });

  if (directFileMatches.length === 1) {
    const match = directFileMatches[0];
    return baseIntentResolution("replace_existing", {
      confidence: "high",
      requiresPrompt: true,
      recommendedChoice: "replace",
      matchedNodeId: match.id,
      matchedNodeName: match.name,
      reason: `${match.name} is already linked to this task with the same normalized filename.`,
    });
  }

  if (directFileMatches.length > 1) {
    return baseIntentResolution("ambiguous", {
      confidence: "medium",
      requiresPrompt: true,
      recommendedChoice: "attach_new",
      reason: "Multiple linked files look like possible matches for this upload.",
    });
  }

  const candidateNode = input.candidateNode ?? null;
  if (candidateNode) {
    if (attachments.some((attachment) => attachment.id === candidateNode.id)) {
      return baseIntentResolution("attach_existing", {
        confidence: "high",
        recommendedChoice: "attach_new",
        matchedNodeId: candidateNode.id,
        matchedNodeName: candidateNode.name,
        reason: `${candidateNode.name} is already attached to this task.`,
      });
    }

    const linkedFolder = linkedFolders.find((folder) => isDescendantPath(folder.path, candidateNode.path));
    if (linkedFolder) {
      return baseIntentResolution("candidate_child_of_linked_folder", {
        confidence: "high",
        requiresPrompt: true,
        recommendedChoice: "link_existing",
        matchedNodeId: candidateNode.id,
        matchedNodeName: candidateNode.name,
        linkedFolderId: linkedFolder.id,
        linkedFolderName: linkedFolder.name,
        linkedFolderPath: linkedFolder.path,
        reason: `${candidateNode.name} already lives under the linked folder ${linkedFolder.name}.`,
      });
    }
  }

  const searchMatches = input.searchMatches ?? [];
  const descendantMatches = searchMatches.filter((match) => {
    if (match.type !== "file") return false;
    return linkedFolders.some((folder) => isDescendantPath(folder.path, match.path));
  });
  const exactDescendantMatches = descendantMatches.filter((match) => {
    return normalizeToken(match.name) === candidateToken && normalizedExtension(match.name) === candidateExt;
  });

  if (exactDescendantMatches.length === 1) {
    const match = exactDescendantMatches[0];
    const linkedFolder = linkedFolders.find((folder) => isDescendantPath(folder.path, match.path)) ?? null;
    return baseIntentResolution("candidate_child_of_linked_folder", {
      confidence: "medium",
      requiresPrompt: true,
      recommendedChoice: "link_existing",
      matchedNodeId: match.id,
      matchedNodeName: match.name,
      linkedFolderId: linkedFolder?.id ?? null,
      linkedFolderName: linkedFolder?.name ?? null,
      linkedFolderPath: linkedFolder?.path ?? null,
      reason: `${match.name} already exists under a folder linked to this task.`,
    });
  }

  if (exactDescendantMatches.length > 1) {
    return baseIntentResolution("ambiguous", {
      confidence: "medium",
      requiresPrompt: true,
      recommendedChoice: "attach_new",
      reason: "More than one file under linked folders looks like a possible match.",
    });
  }

  return baseIntentResolution(candidateNode ? "attach_existing" : "attach_new", {
    confidence: "low",
    recommendedChoice: "attach_new",
    reason: "No meaningful task-linked match was found.",
  });
}
