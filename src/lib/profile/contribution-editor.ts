import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import type { ProfileContributionMutation } from "@/lib/profile/contribution-contract";

export type ContributionEditorEntry = {
  draftId: string;
  contributionId: string | null;
  externalKey: string | null;
  version: number;
  projectId: string | null;
  projectTitle: string;
  roleTitle: string;
  startedAt: string;
  endedAt: string;
  projectUrl: string;
  repositoryUrl: string;
  skills: string[];
  summary: string;
  visibility: "public" | "private";
  kind: "platform" | "external";
};

function month(value: string | null | undefined) {
  return value?.slice(0, 7) ?? "";
}

function normalizedSkills(value: readonly string[]) {
  return Array.from(new Set(value.map((skill) => skill.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

export function contributionToEditorEntry(
  contribution: ProfileCollaborationContribution,
): ContributionEditorEntry {
  return {
    draftId: contribution.id,
    contributionId: contribution.id,
    externalKey: contribution.externalKey ?? null,
    version: contribution.version ?? 1,
    projectId: contribution.projectId,
    projectTitle: contribution.projectTitle,
    roleTitle: contribution.title,
    startedAt: month(contribution.startDate),
    endedAt: month(contribution.endDate),
    projectUrl: contribution.projectUrl ?? contribution.projectHref ?? "",
    repositoryUrl: contribution.repoUrl ?? "",
    skills: normalizedSkills(contribution.skills ?? []),
    summary: contribution.description ?? "",
    visibility: contribution.visibility === "private" ? "private" : "public",
    kind: contribution.projectId ? "platform" : "external",
  };
}

export function createExternalContributionDraft(): ContributionEditorEntry {
  const id = crypto.randomUUID();
  return {
    draftId: id,
    contributionId: null,
    externalKey: `manual:${id}`,
    version: 0,
    projectId: null,
    projectTitle: "",
    roleTitle: "",
    startedAt: "",
    endedAt: "",
    projectUrl: "",
    repositoryUrl: "",
    skills: [],
    summary: "",
    visibility: "private",
    kind: "external",
  };
}

function comparable(entry: ContributionEditorEntry) {
  return {
    projectTitle: entry.projectTitle.trim(),
    roleTitle: entry.roleTitle.trim(),
    startedAt: month(entry.startedAt),
    endedAt: month(entry.endedAt),
    projectUrl: entry.projectUrl.trim(),
    repositoryUrl: entry.repositoryUrl.trim(),
    skills: normalizedSkills(entry.skills),
    summary: entry.summary.trim(),
    visibility: entry.visibility,
  };
}

export function contributionEntryChanged(
  current: ContributionEditorEntry,
  original: ContributionEditorEntry | undefined,
) {
  if (!original) return true;
  return JSON.stringify(comparable(current)) !== JSON.stringify(comparable(original));
}

export function buildContributionMutations(
  originalEntries: readonly ContributionEditorEntry[],
  entries: readonly ContributionEditorEntry[],
): ProfileContributionMutation[] {
  const originalById = new Map(originalEntries.map((entry) => [entry.draftId, entry]));
  const currentById = new Map(entries.map((entry) => [entry.draftId, entry]));
  const mutations: ProfileContributionMutation[] = [];

  for (const original of originalEntries) {
    if (currentById.has(original.draftId)) continue;
    // Platform membership owns platform contribution lifecycle. Omitting a platform
    // row from an editor request therefore means unchanged, never deleted or hidden.
    if (original.kind === "platform" || !original.contributionId) continue;
    mutations.push({
      kind: "external-delete",
      contributionId: original.contributionId,
      expectedVersion: original.version,
    });
  }

  for (const entry of entries) {
    const original = originalById.get(entry.draftId);
    if (!contributionEntryChanged(entry, original)) continue;
    if (entry.kind === "platform") {
      if (!entry.contributionId || entry.version < 1) continue;
      mutations.push({
        kind: "platform",
        contributionId: entry.contributionId,
        expectedVersion: entry.version,
        visibility: entry.visibility,
        summary: entry.summary.trim() || null,
        repositoryUrl: entry.repositoryUrl.trim() || null,
        skills: normalizedSkills(entry.skills),
        dates: { startedAt: month(entry.startedAt) || null, endedAt: month(entry.endedAt) || null },
      });
      continue;
    }
    mutations.push({
      kind: "external",
      ...(entry.contributionId
        ? { contributionId: entry.contributionId, expectedVersion: entry.version }
        : {}),
      externalKey: entry.externalKey ?? `manual:${entry.draftId}`,
      projectTitle: entry.projectTitle.trim(),
      roleTitle: entry.roleTitle.trim() || null,
      summary: entry.summary.trim() || null,
      projectUrl: entry.projectUrl.trim() || null,
      repositoryUrl: entry.repositoryUrl.trim() || null,
      visibility: entry.visibility,
      skills: normalizedSkills(entry.skills),
      dates: { startedAt: month(entry.startedAt) || null, endedAt: month(entry.endedAt) || null },
    });
  }

  return mutations;
}
