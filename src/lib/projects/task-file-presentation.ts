import type { ProjectNode } from "@/lib/db/schema";
import {
  inferTaskFileRole,
  type TaskFileResolutionChoice,
  type TaskFileReadinessWarning,
  type TaskFileRole,
} from "@/lib/projects/task-file-intelligence";

export type TaskFileResolutionCandidateType = "file" | "folder";

export type TaskFileRoleSummaryItem = {
  label: "Deliverables" | "Working" | "Reference";
  count: number;
};

export type TaskFileOutcomeSummary = {
  headline: string;
  detail: string;
  currentDeliverableId: string | null;
};

export type TaskFileChoicePreview = {
  title: string;
  detail: string;
};

type TaskFileRoleSummaryInput = Pick<ProjectNode, "name" | "type" | "path"> & {
  annotation?: string | null;
};

type TaskFileOutcomeInput = (Pick<
  ProjectNode,
  "id" | "name" | "type" | "path" | "updatedAt"
> & {
  annotation?: string | null;
  currentVersion?: number | null;
})[];

function toTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getRolePriority(role: TaskFileRole) {
  if (role === "deliverable") return 3;
  if (role === "working") return 2;
  return 1;
}

function normalizeHintToken(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeTaskFileRoles(
  attachments: TaskFileRoleSummaryInput[],
): TaskFileRoleSummaryItem[] {
  const counts = attachments.reduce(
    (acc, attachment) => {
      const role = inferTaskFileRole({
        name: attachment.name,
        type: attachment.type,
        path: attachment.path,
        annotation: attachment.annotation ?? null,
      });
      acc[role] += 1;
      return acc;
    },
    { deliverable: 0, reference: 0, working: 0 },
  );

  return [
    counts.deliverable > 0 ? { label: "Deliverables", count: counts.deliverable } : null,
    counts.working > 0 ? { label: "Working", count: counts.working } : null,
    counts.reference > 0 ? { label: "Reference", count: counts.reference } : null,
  ].filter(Boolean) as TaskFileRoleSummaryItem[];
}

export function formatTaskFileRoleSummaryLabel(items: TaskFileRoleSummaryItem[]) {
  if (items.length === 0) return "No file roles detected yet";
  return items.map((item) => `${item.count} ${item.label.toLowerCase()}`).join(" · ");
}

export function buildTaskFileOutcomeSummary(
  attachments: TaskFileOutcomeInput,
  warnings: TaskFileReadinessWarning[] = [],
): TaskFileOutcomeSummary {
  const fileAttachments = attachments.filter((attachment) => attachment.type === "file");
  const ranked = [...fileAttachments].sort((a, b) => {
    const roleA = inferTaskFileRole(a);
    const roleB = inferTaskFileRole(b);
    const roleDelta = getRolePriority(roleB) - getRolePriority(roleA);
    if (roleDelta !== 0) return roleDelta;

    const versionA = a.currentVersion ?? 0;
    const versionB = b.currentVersion ?? 0;
    if (versionA !== versionB) return versionB - versionA;

    const updatedDelta = toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;

    return a.name.localeCompare(b.name);
  });

  const primary = ranked.find((attachment) => inferTaskFileRole(attachment) === "deliverable") ?? null;

  if (primary) {
    const version = primary.currentVersion ?? 1;
    return {
      headline: `Current deliverable: ${primary.name}`,
      detail:
        version > 1
          ? `This task currently points at ${primary.name} v${version} as the likely final output.`
          : `This task currently points at ${primary.name} as the likely final output.`,
      currentDeliverableId: primary.id,
    };
  }

  if (warnings.some((warning) => warning.code === "warning_missing_deliverable")) {
    return {
      headline: "No final deliverable confirmed yet",
      detail: "Attach the file or folder this task is expected to produce so the task can end with a clear output.",
      currentDeliverableId: null,
    };
  }

  if (ranked.length > 0) {
    const fallback = ranked[0];
    const role = inferTaskFileRole(fallback);
    const label =
      role === "reference"
        ? "Reference files are linked, but no final output is confirmed yet."
        : `${fallback.name} is the active working file, but no final deliverable is confirmed yet.`;
    return {
      headline: "No final deliverable confirmed yet",
      detail: label,
      currentDeliverableId: null,
    };
  }

  return {
    headline: "No task files linked yet",
    detail: "Start by attaching the file or folder this task depends on.",
    currentDeliverableId: null,
  };
}

export function summarizeTaskFileWarningNextStep(
  warnings: TaskFileReadinessWarning[],
) {
  if (warnings.some((warning) => warning.code === "warning_unresolved_replacement")) {
    return "Resolve the open replace-or-attach decision so the file list can settle.";
  }
  if (warnings.some((warning) => warning.code === "warning_missing_deliverable")) {
    return "Add the file or folder that represents the task’s final output.";
  }
  if (warnings.some((warning) => warning.code === "warning_only_reference_files")) {
    return "Link or classify the actual output file so the task ends with a clear deliverable.";
  }
  if (warnings.some((warning) => warning.code === "warning_unclassified_upload")) {
    return "Review the most recent upload so the task file list reflects where that file belongs.";
  }
  return "Review the outstanding file checks so this task has a clear finish line.";
}

export function buildAttachCandidateHints(
  node: Pick<ProjectNode, "id" | "name" | "type" | "path">,
  attachments: TaskFileOutcomeInput,
  mode: "recent" | "search",
) {
  const hints: string[] = [];
  const normalizedName = normalizeHintToken(node.name);
  const directNameMatch = attachments.find(
    (attachment) => attachment.id !== node.id && normalizeHintToken(attachment.name) === normalizedName,
  );
  const linkedFolderMatch = attachments.find(
    (attachment) =>
      attachment.type === "folder" &&
      typeof attachment.path === "string" &&
      typeof node.path === "string" &&
      node.path.startsWith(`${attachment.path}/`),
  );

  if (directNameMatch) {
    hints.push(`Matches the linked item name ${directNameMatch.name}`);
  }
  if (linkedFolderMatch) {
    hints.push(`Lives under linked folder ${linkedFolderMatch.name}`);
  }
  if (mode === "recent") {
    hints.push("Recently updated in this project");
  }

  return hints.slice(0, 2);
}

export function getTaskFileResolutionChoiceCopy(
  choice: TaskFileResolutionChoice,
  candidateType: TaskFileResolutionCandidateType = "file",
) {
  if (candidateType === "folder") {
    if (choice === "replace") {
      return {
        label: "Replace folder contents",
        description:
          "Upload into the existing linked folder. Files with matching names collide — we'll suffix them so nothing is silently overwritten.",
      };
    }
    if (choice === "merge") {
      return {
        label: "Merge into existing folder",
        description:
          "Drop these files into the linked folder. Matching names get saved as new files alongside originals.",
      };
    }
    if (choice === "subfolder") {
      return {
        label: "Add as a subfolder",
        description:
          "Create a new folder inside the linked one. Keeps the original contents untouched.",
      };
    }
    if (choice === "attach_new") {
      return {
        label: "Attach as new folder",
        description:
          "Create a fresh folder at the task root and link it. Existing attachments are left alone.",
      };
    }
    return {
      label: "Cancel",
      description: "Leave the drop unresolved. Nothing gets uploaded.",
    };
  }

  if (choice === "replace") {
    return {
      label: "Replace existing link",
      description: "Use the new file for this task and unlink the older direct task file.",
    };
  }
  if (choice === "link_existing") {
    return {
      label: "Keep folder context",
      description:
        "Use the file that already exists under the linked folder without creating a second root attachment.",
    };
  }
  if (choice === "attach_new") {
    return {
      label: "Attach as new",
      description:
        "Keep the current linked files untouched and add this as a separate task attachment.",
    };
  }
  return {
    label: "Cancel",
    description: "Leave the file unresolved for now and keep the current task attachments unchanged.",
  };
}

export function buildTaskFileChoicePreview(
  choice: TaskFileResolutionChoice,
  candidateType: TaskFileResolutionCandidateType = "file",
): TaskFileChoicePreview {
  if (candidateType === "folder") {
    if (choice === "replace") {
      return {
        title: "Result",
        detail: "The linked folder stays in place and its contents are refreshed with the incoming folder files.",
      };
    }
    if (choice === "merge") {
      return {
        title: "Result",
        detail: "The current linked folder stays at the task root and the incoming files are merged into it.",
      };
    }
    if (choice === "subfolder") {
      return {
        title: "Result",
        detail: "The task keeps its current root folder and the incoming folder is added beneath it as a subfolder.",
      };
    }
    if (choice === "attach_new") {
      return {
        title: "Result",
        detail: "A separate root folder is added to the task so both folder trees stay visible.",
      };
    }
    return {
      title: "Result",
      detail: "Nothing is attached until you choose how this folder should fit into the task.",
    };
  }

  if (choice === "replace") {
    return {
      title: "Result",
      detail: "The current direct task file is swapped out and this file becomes the new main linked item for the task.",
    };
  }
  if (choice === "link_existing") {
    return {
      title: "Result",
      detail: "The task keeps a clean root list and uses the file that already exists inside the linked folder.",
    };
  }
  if (choice === "attach_new") {
    return {
      title: "Result",
      detail: "This file appears as a separate root attachment alongside the current task files.",
    };
  }
  return {
    title: "Result",
    detail: "Nothing changes until you decide how this file should be attached.",
  };
}
