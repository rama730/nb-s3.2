import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  profileCollaborationSummaries,
  profileProjectContributionStages,
  profileProjectContributions,
  profiles,
  projects,
  roleApplications,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { normalizeProjectDescription, normalizeProjectTitle, trimDisplayText, trimOptionalDisplayText } from "@/lib/profile/display";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProfileCollaborationMemberPreview = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

export type ProfileCollaborationProject = {
  id: string;
  ownerId: string;
  title: string;
  slug: string | null;
  description: string;
  shortDescription: string | null;
  coverImage: string | null;
  href: string;
  image: string | null;
  url: string;
  members: ProfileCollaborationMemberPreview[];
  userRole: string;
  roleKind: string;
  joinedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  viewCount: number | null;
  followersCount: number | null;
  category: string | null;
  visibility: string | null;
  status: string | null;
  skills: string[];
  tags: string[];
  verified: boolean;
};

export type ProfileCollaborationRoleStage = {
  id: string;
  contributionId: string | null;
  roleKind: string;
  roleTitle: string;
  summary: string | null;
  skills: string[];
  startDate: string | null;
  endDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  currentlyActive: boolean;
  source: string;
  verified: boolean;
  verifiedAt: string | null;
  visibility: "public" | "private";
  manualOverride: boolean;
  statusLabel: string;
};

export type ProfileCollaborationContribution = {
  id: string;
  projectId: string | null;
  title: string;
  projectTitle: string;
  projectHref: string | null;
  repoUrl: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  currentlyActive: boolean;
  skills: string[];
  source: string;
  verified: boolean;
  roleKind?: string;
  roleStages?: ProfileCollaborationRoleStage[];
  stageCount?: number;
  statusLabel?: string;
  visibility?: "public" | "private";
};

export type ProfileCollaborationSummary = {
  version: number;
  generatedAt: string;
  projects: ProfileCollaborationProject[];
  featuredProjects: ProfileCollaborationProject[];
  contributions: ProfileCollaborationContribution[];
  stats: {
    projectsCount: number;
    visibleProjectsCount: number;
    contributionCount: number;
  };
  cacheStatus?: "hit" | "miss" | "bypass";
};

export type ProfileInviteProjectOption = {
  id: string;
  title: string;
  slug: string | null;
  role: "owner" | "admin";
  href: string;
};

type ProfileProjectRow = {
  contribution_id: string | null;
  project_id: string;
  owner_id: string;
  title: string | null;
  slug: string | null;
  description: string | null;
  short_description: string | null;
  cover_image: string | null;
  category: string | null;
  view_count: number | string | null;
  followers_count: number | string | null;
  tags: unknown;
  skills: unknown;
  visibility: string | null;
  status: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  user_role: string | null;
  joined_at: Date | string | null;
  contribution_started_at: Date | string | null;
  contribution_ended_at: Date | string | null;
  contribution_visibility: "public" | "private" | null;
  contribution_source: string | null;
  accepted_role_title: string | null;
  contribution_role_title: string | null;
  contribution_summary: string | null;
  contribution_skills: unknown;
  member_previews: unknown;
  role_stages: unknown;
  total_count: number | string;
};

const SUMMARY_VERSION = 2;
const SUMMARY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 12;
const EMPTY_SUMMARY: ProfileCollaborationSummary = {
  version: SUMMARY_VERSION,
  generatedAt: "",
  projects: [],
  featuredProjects: [],
  contributions: [],
  stats: {
    projectsCount: 0,
    visibleProjectsCount: 0,
    contributionCount: 0,
  },
};

function nowIso() {
  return new Date().toISOString();
}

function buildProjectHref(project: { id: string; slug: string | null }) {
  return project.slug ? `/projects/${project.slug}` : `/projects/${project.id}`;
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toShortDate(value: Date | string | null | undefined) {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => trimDisplayText(item)).filter(Boolean).slice(0, 12);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return stringArray(parsed);
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
    }
  }
  return [];
}

function defaultRoleTitle(roleKind: string | null | undefined) {
  switch (roleKind) {
    case "owner":
      return "Lead";
    case "admin":
      return "Co-lead";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    default:
      return "Contributor";
  }
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (typeof value === "string") {
    try {
      return objectArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function memberPreviews(value: unknown): ProfileCollaborationMemberPreview[] {
  return objectArray(value).map((member) => ({
    id: trimDisplayText(member.id),
    displayName: trimDisplayText(member.displayName) || trimDisplayText(member.fullName) || trimDisplayText(member.username) || "Collaborator",
    username: trimOptionalDisplayText(member.username),
    avatarUrl: trimOptionalDisplayText(member.avatarUrl),
  })).filter((member) => member.id).slice(0, 3);
}

function roleLabel(row: ProfileProjectRow) {
  const specificRole = trimDisplayText(row.contribution_role_title) || trimDisplayText(row.accepted_role_title);
  const roleKind = trimDisplayText(row.user_role) || (row.owner_id ? "member" : "contributor");
  if (roleKind === "owner") return specificRole ? `${specificRole} - Lead` : "Lead";
  if (roleKind === "admin") return specificRole ? `${specificRole} - Co-lead` : "Co-lead";
  if (specificRole) return specificRole;
  return defaultRoleTitle(roleKind);
}

function roleStageFromObject(stage: Record<string, unknown>, fallbackContributionId: string | null): ProfileCollaborationRoleStage | null {
  const id = trimDisplayText(stage.id);
  const roleKind = trimDisplayText(stage.roleKind) || trimDisplayText(stage.role_kind) || "contributor";
  const roleTitle = trimDisplayText(stage.roleTitle) || trimDisplayText(stage.role_title) || defaultRoleTitle(roleKind);
  if (!id && !roleTitle) return null;
  const endedAt = toIsoDate((stage.endedAt ?? stage.ended_at) as Date | string | null | undefined);
  const verifiedAt = toIsoDate((stage.verifiedAt ?? stage.verified_at) as Date | string | null | undefined);
  const visibility = trimDisplayText(stage.visibility) === "private" ? "private" : "public";
  const currentlyActive = !endedAt;
  return {
    id: id || `${fallbackContributionId ?? "manual"}:${roleTitle}`,
    contributionId: trimOptionalDisplayText(stage.contributionId ?? stage.contribution_id) ?? fallbackContributionId,
    roleKind,
    roleTitle,
    summary: trimOptionalDisplayText(stage.summary),
    skills: stringArray(stage.skills),
    startDate: toShortDate((stage.startedAt ?? stage.started_at) as Date | string | null | undefined),
    endDate: toShortDate((stage.endedAt ?? stage.ended_at) as Date | string | null | undefined),
    startedAt: toIsoDate((stage.startedAt ?? stage.started_at) as Date | string | null | undefined),
    endedAt,
    currentlyActive,
    source: trimDisplayText(stage.source) || "membership",
    verified: Boolean(verifiedAt),
    verifiedAt,
    visibility,
    manualOverride: Boolean(stage.manualOverride ?? stage.manual_override),
    statusLabel: currentlyActive ? "Current" : "Past role",
  };
}

function roleStages(value: unknown, fallbackContributionId: string | null): ProfileCollaborationRoleStage[] {
  return objectArray(value)
    .map((stage) => roleStageFromObject(stage, fallbackContributionId))
    .filter((stage): stage is ProfileCollaborationRoleStage => Boolean(stage))
    .sort((left, right) => {
      if (left.currentlyActive !== right.currentlyActive) return left.currentlyActive ? -1 : 1;
      return String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? ""));
    });
}

function projectFromRow(row: ProfileProjectRow): ProfileCollaborationProject {
  const title = normalizeProjectTitle(row.title);
  const description = normalizeProjectDescription(row.short_description, row.description);
  const href = buildProjectHref({ id: row.project_id, slug: row.slug });
  const roleKind = trimDisplayText(row.user_role) || "contributor";
  return {
    id: row.project_id,
    ownerId: row.owner_id,
    title,
    slug: row.slug,
    description,
    shortDescription: trimOptionalDisplayText(row.short_description),
    coverImage: trimOptionalDisplayText(row.cover_image),
    href,
    image: trimOptionalDisplayText(row.cover_image),
    url: href,
    members: memberPreviews(row.member_previews),
    userRole: roleLabel(row),
    roleKind,
    joinedAt: toIsoDate(row.contribution_started_at) ?? toIsoDate(row.joined_at),
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
    viewCount: numberOrNull(row.view_count),
    followersCount: numberOrNull(row.followers_count),
    category: trimOptionalDisplayText(row.category),
    visibility: trimOptionalDisplayText(row.visibility),
    status: trimOptionalDisplayText(row.status),
    skills: stringArray(row.contribution_skills).length ? stringArray(row.contribution_skills) : stringArray(row.skills),
    tags: stringArray(row.tags),
    verified: true,
  };
}

function manualContributionFromExperience(entry: Record<string, unknown>, index: number): ProfileCollaborationContribution | null {
  const projectTitle = trimDisplayText(entry.company) || trimDisplayText(entry.projectTitle) || trimDisplayText(entry.name);
  const title = trimDisplayText(entry.title) || "Contributor";
  if (!projectTitle && !title) return null;
  return {
    id: trimDisplayText(entry.id) || `manual:${index}`,
    projectId: trimOptionalDisplayText(entry.projectId),
    title,
    projectTitle: projectTitle || "External project",
    projectHref: trimOptionalDisplayText(entry.projectUrl || entry.link),
    repoUrl: trimOptionalDisplayText(entry.repoUrl),
    description: trimOptionalDisplayText(entry.description),
    startDate: trimOptionalDisplayText(entry.startDate),
    endDate: trimOptionalDisplayText(entry.endDate),
    currentlyActive: Boolean(entry.currentlyActive),
    skills: stringArray(entry.techTags),
    source: "manual",
    verified: false,
    roleKind: "contributor",
    roleStages: [{
      id: trimDisplayText(entry.id) || `manual:${index}:stage`,
      contributionId: null,
      roleKind: "contributor",
      roleTitle: title,
      summary: trimOptionalDisplayText(entry.description),
      skills: stringArray(entry.techTags),
      startDate: trimOptionalDisplayText(entry.startDate),
      endDate: trimOptionalDisplayText(entry.endDate),
      startedAt: trimOptionalDisplayText(entry.startDate),
      endedAt: trimOptionalDisplayText(entry.endDate),
      currentlyActive: Boolean(entry.currentlyActive),
      source: "manual",
      verified: false,
      verifiedAt: null,
      visibility: "public",
      manualOverride: true,
      statusLabel: Boolean(entry.currentlyActive) ? "Current" : "Past role",
    }],
    stageCount: 1,
    statusLabel: Boolean(entry.currentlyActive) ? "Current" : "Past project",
    visibility: "public",
  };
}

function contributionFromProject(project: ProfileCollaborationProject, row: ProfileProjectRow, manual?: ProfileCollaborationContribution | null): ProfileCollaborationContribution {
  const stages = roleStages(row.role_stages, row.contribution_id);
  const fallbackStage: ProfileCollaborationRoleStage = {
    id: row.contribution_id ? `${row.contribution_id}:current` : `verified:${project.id}:current`,
    contributionId: row.contribution_id,
    roleKind: project.roleKind,
    roleTitle: manual?.title && manual.title !== "Contributor" ? manual.title : project.userRole,
    summary: trimOptionalDisplayText(row.contribution_summary) ?? manual?.description ?? null,
    skills: manual?.skills.length ? manual.skills : project.skills,
    startDate: manual?.startDate ?? toShortDate(row.contribution_started_at) ?? toShortDate(row.joined_at) ?? toShortDate(row.created_at),
    endDate: manual?.endDate ?? toShortDate(row.contribution_ended_at),
    startedAt: toIsoDate(row.contribution_started_at) ?? toIsoDate(row.joined_at) ?? toIsoDate(row.created_at),
    endedAt: toIsoDate(row.contribution_ended_at),
    currentlyActive: !row.contribution_ended_at,
    source: trimDisplayText(row.accepted_role_title) ? "application" : "membership",
    verified: true,
    verifiedAt: null,
    visibility: row.contribution_visibility === "private" ? "private" : "public",
    manualOverride: false,
    statusLabel: row.contribution_ended_at ? "Past role" : "Current",
  };
  const normalizedStages = stages.length ? stages : [fallbackStage];
  const activeStage = normalizedStages.find((stage) => stage.currentlyActive) ?? normalizedStages[0] ?? fallbackStage;
  const currentlyActive = normalizedStages.some((stage) => stage.currentlyActive) && !row.contribution_ended_at;
  const startDate = normalizedStages[normalizedStages.length - 1]?.startDate ?? fallbackStage.startDate;
  const endDate = currentlyActive ? null : (normalizedStages[0]?.endDate ?? fallbackStage.endDate);
  return {
    id: row.contribution_id ?? `verified:${project.id}`,
    projectId: project.id,
    title: activeStage.roleTitle,
    projectTitle: project.title,
    projectHref: project.href,
    repoUrl: manual?.repoUrl ?? null,
    description: activeStage.summary ?? trimOptionalDisplayText(row.contribution_summary) ?? manual?.description ?? null,
    startDate,
    endDate,
    currentlyActive,
    skills: activeStage.skills.length ? activeStage.skills : (manual?.skills.length ? manual.skills : project.skills),
    source: row.contribution_source || (trimDisplayText(row.accepted_role_title) ? "application" : "membership"),
    verified: true,
    roleKind: activeStage.roleKind,
    roleStages: normalizedStages.map((stage) => ({
      ...stage,
      statusLabel: stage.currentlyActive ? "Current" : "Past role",
    })),
    stageCount: normalizedStages.length,
    statusLabel: currentlyActive ? "Current" : "Former collaborator",
    visibility: row.contribution_visibility === "private" ? "private" : "public",
  };
}

async function readProfileExperience(profileId: string) {
  const [profile] = await db
    .select({ experience: profiles.experience })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
    .limit(1);
  return objectArray(profile?.experience);
}

async function queryProfileProjectRows(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
}) {
  const includePrivate = Boolean(options.includePrivate);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 48);
  const offset = Math.max(options.offset ?? 0, 0);
  const visibilitySql = includePrivate
    ? sql`TRUE`
    : sql`p.visibility IN ('public', 'unlisted') AND p.status <> 'draft'`;

  const rows = await db.execute<ProfileProjectRow>(sql`
    WITH project_scope AS (
      SELECT
        pc.id AS contribution_id,
        p.id AS project_id,
        p.owner_id,
        p.title,
        p.slug,
        p.description,
        p.short_description,
        p.cover_image,
        p.category,
        p.view_count,
        p.followers_count,
        p.tags,
        p.skills,
        p.visibility,
        p.status,
        p.created_at,
        p.updated_at,
        CASE
          WHEN p.owner_id = ${profileId} THEN 'owner'
          ELSE COALESCE(pm_self.role, pc.role_kind, 'contributor')
        END AS user_role,
        COALESCE(pm_self.joined_at, p.created_at) AS joined_at,
        pc.started_at AS contribution_started_at,
        pc.ended_at AS contribution_ended_at,
        pc.visibility AS contribution_visibility,
        pc.source AS contribution_source,
        ra.accepted_role_title,
        pc.role_title AS contribution_role_title,
        pc.summary AS contribution_summary,
        pc.skills AS contribution_skills,
        count(*) OVER()::int AS total_count
      FROM ${projects} p
      LEFT JOIN project_members pm_self
        ON pm_self.project_id = p.id
       AND pm_self.user_id = ${profileId}
      LEFT JOIN ${profileProjectContributions} pc
        ON pc.project_id = p.id
       AND pc.profile_id = ${profileId}
       AND pc.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT accepted_role_title
        FROM ${roleApplications}
        WHERE project_id = p.id
          AND applicant_id = ${profileId}
          AND status = 'accepted'
        ORDER BY updated_at DESC
        LIMIT 1
      ) ra ON true
      WHERE p.deleted_at IS NULL
        AND (p.owner_id = ${profileId} OR pm_self.id IS NOT NULL OR pc.id IS NOT NULL)
        AND (${visibilitySql})
        AND (${includePrivate ? sql`TRUE` : sql`COALESCE(pc.visibility, 'public') = 'public'`})
      ORDER BY p.view_count DESC NULLS LAST, p.updated_at DESC, p.created_at DESC, p.id DESC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT
      ps.*,
      COALESCE(members.member_previews, '[]'::jsonb) AS member_previews,
      COALESCE(stages.role_stages, '[]'::jsonb) AS role_stages
    FROM project_scope ps
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'displayName', ranked.display_name,
          'username', ranked.username,
          'avatarUrl', ranked.avatar_url
        )
        ORDER BY ranked.member_rank
      ) AS member_previews
      FROM (
        SELECT
          pr.id,
          COALESCE(NULLIF(pr.full_name, ''), NULLIF(pr.username, ''), 'Collaborator') AS display_name,
          pr.username,
          pr.avatar_url,
          row_number() OVER (
            ORDER BY
              CASE WHEN pr.id = ps.owner_id THEN 0 ELSE 1 END,
              pm.joined_at ASC,
              pr.id ASC
          ) AS member_rank
        FROM (
          SELECT ps.owner_id AS user_id, ps.created_at AS joined_at, 'owner'::text AS role
          UNION ALL
          SELECT pm.user_id, pm.joined_at, pm.role
          FROM project_members pm
          WHERE pm.project_id = ps.project_id
            AND pm.user_id <> ps.owner_id
        ) pm
        INNER JOIN ${profiles} pr ON pr.id = pm.user_id
        WHERE pr.deleted_at IS NULL
        ORDER BY
          CASE WHEN pr.id = ps.owner_id THEN 0 ELSE 1 END,
          pm.joined_at ASC,
          pr.id ASC
        LIMIT 3
      ) ranked
      WHERE ranked.member_rank <= 3
    ) members ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pcs.id,
          'contributionId', pcs.contribution_id,
          'roleKind', pcs.role_kind,
          'roleTitle', pcs.role_title,
          'summary', pcs.summary,
          'skills', pcs.skills,
          'startedAt', pcs.started_at,
          'endedAt', pcs.ended_at,
          'source', pcs.source,
          'verifiedAt', pcs.verified_at,
          'visibility', pcs.visibility,
          'manualOverride', pcs.manual_override
        )
        ORDER BY
          CASE WHEN pcs.ended_at IS NULL THEN 0 ELSE 1 END,
          pcs.started_at DESC NULLS LAST,
          pcs.created_at DESC,
          pcs.id DESC
      ) AS role_stages
      FROM ${profileProjectContributionStages} pcs
      WHERE pcs.contribution_id = ps.contribution_id
        AND pcs.deleted_at IS NULL
        AND (${includePrivate ? sql`TRUE` : sql`pcs.visibility = 'public'`})
    ) stages ON true
    ORDER BY ps.view_count DESC NULLS LAST, ps.updated_at DESC, ps.created_at DESC, ps.project_id DESC
  `);

  return Array.from(rows);
}

function buildSummaryFromRows(rows: ProfileProjectRow[], experience: Array<Record<string, unknown>>): ProfileCollaborationSummary {
  const manualByProject = new Map<string, ProfileCollaborationContribution>();
  const manualExternal: ProfileCollaborationContribution[] = [];
  experience.forEach((entry, index) => {
    const manual = manualContributionFromExperience(entry, index);
    if (!manual) return;
    if (manual.projectId) {
      manualByProject.set(manual.projectId, manual);
    } else {
      manualExternal.push(manual);
    }
  });

  const projectsList = rows.map(projectFromRow);
  const contributions = [
    ...projectsList.map((project, index) => contributionFromProject(project, rows[index]!, manualByProject.get(project.id))),
    ...manualExternal,
  ].slice(0, 24);
  const totalCount = Number(rows[0]?.total_count ?? projectsList.length);

  return {
    version: SUMMARY_VERSION,
    generatedAt: nowIso(),
    projects: projectsList.slice(0, 4),
    featuredProjects: projectsList.slice(0, 2),
    contributions,
    stats: {
      projectsCount: totalCount,
      visibleProjectsCount: totalCount,
      contributionCount: contributions.length,
    },
  };
}

async function writePublicSummary(profileId: string, summary: ProfileCollaborationSummary) {
  await db
    .insert(profileCollaborationSummaries)
    .values({
      profileId,
      version: SUMMARY_VERSION,
      summary,
      projectCount: summary.stats.projectsCount,
      visibleProjectCount: summary.stats.visibleProjectsCount,
      contributionCount: summary.stats.contributionCount,
      stale: false,
      refreshedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: profileCollaborationSummaries.profileId,
      set: {
        version: SUMMARY_VERSION,
        summary,
        projectCount: summary.stats.projectsCount,
        visibleProjectCount: summary.stats.visibleProjectsCount,
        contributionCount: summary.stats.contributionCount,
        stale: false,
        refreshedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function getProfileCollaborationSummary(profileId: string, options: {
  includePrivate?: boolean;
  preferCached?: boolean;
  maxAgeMs?: number;
} = {}): Promise<ProfileCollaborationSummary> {
  const startedAt = Date.now();
  const includePrivate = Boolean(options.includePrivate);
  const preferCached = options.preferCached !== false && !includePrivate;
  const maxAgeMs = options.maxAgeMs ?? SUMMARY_TTL_MS;

  if (!profileId) return { ...EMPTY_SUMMARY, cacheStatus: "miss" };

  if (preferCached) {
    const cached = await db.query.profileCollaborationSummaries.findFirst({
      where: eq(profileCollaborationSummaries.profileId, profileId),
      columns: {
        summary: true,
        stale: true,
        refreshedAt: true,
      },
    });
    const ageMs = cached?.refreshedAt ? Date.now() - cached.refreshedAt.getTime() : Number.POSITIVE_INFINITY;
    const cachedSummary = cached?.summary as ProfileCollaborationSummary | undefined;
    if (cached && cachedSummary?.version === SUMMARY_VERSION && !cached.stale && ageMs <= maxAgeMs) {
      logger.metric("profile.collaboration.summary", {
        profileId,
        cacheStatus: "hit",
        includePrivate,
        durationMs: Date.now() - startedAt,
      });
      return { ...cachedSummary, cacheStatus: "hit" };
    }
  }

  const [rows, experience] = await Promise.all([
    queryProfileProjectRows(profileId, { includePrivate, limit: DEFAULT_LIMIT, offset: 0 }),
    readProfileExperience(profileId),
  ]);
  const summary = buildSummaryFromRows(rows, experience);

  if (!includePrivate) {
    await writePublicSummary(profileId, summary);
  }

  logger.metric("profile.collaboration.summary", {
    profileId,
    cacheStatus: includePrivate ? "bypass" : "miss",
    includePrivate,
    projectCount: summary.stats.projectsCount,
    contributionCount: summary.stats.contributionCount,
    durationMs: Date.now() - startedAt,
  });
  return { ...summary, cacheStatus: includePrivate ? "bypass" : "miss" };
}

export async function getProfilePortfolioProjects(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
} = {}) {
  const startedAt = Date.now();
  const rows = await queryProfileProjectRows(profileId, options);
  const projectsList = rows.map(projectFromRow);
  const total = Number(rows[0]?.total_count ?? projectsList.length);
  logger.metric("profile.collaboration.portfolio", {
    profileId,
    includePrivate: Boolean(options.includePrivate),
    count: projectsList.length,
    total,
    durationMs: Date.now() - startedAt,
  });
  return {
    projects: projectsList,
    total,
    hasMore: (options.offset ?? 0) + projectsList.length < total,
  };
}

export async function getProfileInviteProjectOptions(inviterId: string, targetProfileId: string): Promise<ProfileInviteProjectOption[]> {
  if (!inviterId || !targetProfileId || inviterId === targetProfileId) return [];
  const rows = await db.execute<{
    id: string;
    title: string | null;
    slug: string | null;
    role: "owner" | "admin";
  }>(sql`
    SELECT p.id, p.title, p.slug, CASE WHEN p.owner_id = ${inviterId} THEN 'owner' ELSE pm.role END AS role
    FROM ${projects} p
    LEFT JOIN project_members pm
      ON pm.project_id = p.id
     AND pm.user_id = ${inviterId}
    LEFT JOIN project_members target_pm
      ON target_pm.project_id = p.id
     AND target_pm.user_id = ${targetProfileId}
    WHERE p.deleted_at IS NULL
      AND target_pm.id IS NULL
      AND (
        p.owner_id = ${inviterId}
        OR pm.role IN ('owner', 'admin')
      )
    ORDER BY p.updated_at DESC, p.created_at DESC
    LIMIT 20
  `);

  return Array.from(rows).map((row) => ({
    id: row.id,
    title: normalizeProjectTitle(row.title),
    slug: row.slug,
    role: row.role === "admin" ? "admin" : "owner",
    href: buildProjectHref({ id: row.id, slug: row.slug }),
  }));
}

export async function markProfileCollaborationSummaryStale(
  profileIds: string | string[],
  executor: DbExecutor = db,
) {
  const ids = Array.from(new Set((Array.isArray(profileIds) ? profileIds : [profileIds]).filter(Boolean)));
  if (ids.length === 0) return;
  await executor
    .insert(profileCollaborationSummaries)
    .values(ids.map((profileId) => ({
      profileId,
      version: SUMMARY_VERSION,
      summary: EMPTY_SUMMARY,
      projectCount: 0,
      visibleProjectCount: 0,
      contributionCount: 0,
      stale: true,
      refreshedAt: new Date(0),
      updatedAt: new Date(),
    })))
    .onConflictDoUpdate({
      target: profileCollaborationSummaries.profileId,
      set: {
        stale: true,
        updatedAt: new Date(),
      },
    });
}

export async function upsertProfileProjectContributionFromMembership(
  executor: DbExecutor,
  params: {
    profileId: string;
    projectId: string;
    verifiedBy: string | null;
    previousRole?: string | null;
    nextRole?: string | null;
    eventId?: string | null;
    source?: "membership" | "application" | "owner" | "role_change" | "project_invite" | "ownership_transfer" | "backfill";
    effectiveAt?: Date;
  },
) {
  const effectiveAt = params.effectiveAt ?? new Date();
  const contributionRows = await executor.execute<{
    id: string;
    profile_id: string;
    project_id: string;
    source: string;
    role_kind: string;
    role_title: string | null;
    skills: unknown;
    started_at: Date | string | null;
    verified_at: Date | string | null;
    verified_by: string | null;
    visibility: "public" | "private";
  }>(sql`
    INSERT INTO ${profileProjectContributions} (
      profile_id,
      project_id,
      source,
      role_kind,
      role_title,
      skills,
      started_at,
      verified_at,
      verified_by,
      visibility,
      updated_at
    )
    SELECT
      ${params.profileId},
      p.id,
      CASE WHEN ra.accepted_role_title IS NULL THEN
        CASE WHEN p.owner_id = ${params.profileId} THEN 'owner' ELSE 'membership' END
      ELSE 'application' END,
      CASE WHEN p.owner_id = ${params.profileId} THEN 'owner' ELSE COALESCE(pm.role, 'contributor') END,
      CASE
        WHEN p.owner_id = ${params.profileId} THEN COALESCE(NULLIF(p.import_source->'metadata'->>'leadFocus', ''), NULLIF(ra.accepted_role_title, ''), 'Lead')
        WHEN pm.role = 'admin' THEN COALESCE(NULLIF(ra.accepted_role_title, ''), 'Co-lead')
        WHEN pm.role = 'viewer' THEN COALESCE(NULLIF(ra.accepted_role_title, ''), 'Viewer')
        ELSE COALESCE(NULLIF(ra.accepted_role_title, ''), 'Member')
      END,
      COALESCE(p.skills, '[]'::jsonb),
      COALESCE(pm.joined_at, p.created_at),
      now(),
      ${params.verifiedBy},
      'public',
      now()
    FROM ${projects} p
    LEFT JOIN project_members pm
      ON pm.project_id = p.id
     AND pm.user_id = ${params.profileId}
    LEFT JOIN LATERAL (
      SELECT accepted_role_title
      FROM ${roleApplications}
      WHERE project_id = p.id
        AND applicant_id = ${params.profileId}
        AND status = 'accepted'
      ORDER BY updated_at DESC
      LIMIT 1
    ) ra ON true
    WHERE p.id = ${params.projectId}
      AND p.deleted_at IS NULL
      AND (p.owner_id = ${params.profileId} OR pm.id IS NOT NULL)
    ON CONFLICT (profile_id, project_id) WHERE deleted_at IS NULL DO UPDATE SET
      source = EXCLUDED.source,
      role_kind = EXCLUDED.role_kind,
      role_title = EXCLUDED.role_title,
      skills = EXCLUDED.skills,
      started_at = COALESCE(${profileProjectContributions.startedAt}, EXCLUDED.started_at),
      verified_at = EXCLUDED.verified_at,
      verified_by = COALESCE(EXCLUDED.verified_by, ${profileProjectContributions.verifiedBy}),
      updated_at = now()
    RETURNING id, profile_id, project_id, source, role_kind, role_title, skills, started_at, verified_at, verified_by, visibility
  `);
  const contribution = Array.from(contributionRows)[0];
  if (contribution) {
    const previousRole = trimOptionalDisplayText(params.previousRole);
    const nextRole = trimDisplayText(params.nextRole) || contribution.role_kind;
    const shouldCreateNewStage = !previousRole || previousRole !== nextRole || Boolean(params.eventId);

    if (shouldCreateNewStage) {
      await executor
        .update(profileProjectContributionStages)
        .set({ endedAt: effectiveAt, updatedAt: new Date() })
        .where(and(
          eq(profileProjectContributionStages.contributionId, contribution.id),
          isNull(profileProjectContributionStages.endedAt),
          isNull(profileProjectContributionStages.deletedAt),
        ));

      await executor
        .insert(profileProjectContributionStages)
        .values({
          contributionId: contribution.id,
          profileId: params.profileId,
          projectId: params.projectId,
          source: params.source ?? (contribution.source === "owner" ? "owner" : contribution.source === "application" ? "application" : "membership"),
          roleKind: contribution.role_kind as "owner" | "admin" | "member" | "viewer" | "contributor",
          roleTitle: contribution.role_title || defaultRoleTitle(contribution.role_kind),
          skills: stringArray(contribution.skills),
          startedAt: effectiveAt,
          verifiedAt: new Date(),
          verifiedBy: params.verifiedBy,
          eventId: params.eventId ?? null,
          visibility: contribution.visibility,
          manualOverride: false,
        })
        .onConflictDoNothing();
    }
  }
  await markProfileCollaborationSummaryStale(params.profileId, executor);
}

export async function endProfileProjectContributionMembership(
  executor: DbExecutor,
  params: { profileId: string; projectId: string; verifiedBy: string | null; eventId?: string | null; endedAt?: Date },
) {
  const endedAt = params.endedAt ?? new Date();
  await executor
    .update(profileProjectContributions)
    .set({ endedAt, updatedAt: new Date() })
    .where(and(
      eq(profileProjectContributions.profileId, params.profileId),
      eq(profileProjectContributions.projectId, params.projectId),
      isNull(profileProjectContributions.deletedAt),
    ));

  await executor
    .update(profileProjectContributionStages)
    .set({ endedAt, updatedAt: new Date() })
    .where(and(
      eq(profileProjectContributionStages.profileId, params.profileId),
      eq(profileProjectContributionStages.projectId, params.projectId),
      isNull(profileProjectContributionStages.endedAt),
      isNull(profileProjectContributionStages.deletedAt),
    ));
  await markProfileCollaborationSummaryStale(params.profileId, executor);
}

export async function updateProfileProjectContributionStage(
  profileId: string,
  stageId: string,
  updates: {
    roleTitle?: string | null;
    summary?: string | null;
    skills?: string[];
    visibility?: "public" | "private";
  },
) {
  const [stage] = await db
    .update(profileProjectContributionStages)
    .set({
      ...(updates.roleTitle !== undefined ? { roleTitle: trimOptionalDisplayText(updates.roleTitle) } : {}),
      ...(updates.summary !== undefined ? { summary: trimOptionalDisplayText(updates.summary) } : {}),
      ...(updates.skills !== undefined ? { skills: updates.skills.map((skill) => trimDisplayText(skill)).filter(Boolean).slice(0, 24) } : {}),
      ...(updates.visibility !== undefined ? { visibility: updates.visibility } : {}),
      manualOverride: true,
      updatedAt: new Date(),
    })
    .where(and(
      eq(profileProjectContributionStages.id, stageId),
      eq(profileProjectContributionStages.profileId, profileId),
      isNull(profileProjectContributionStages.deletedAt),
    ))
    .returning({
      id: profileProjectContributionStages.id,
      contributionId: profileProjectContributionStages.contributionId,
      projectId: profileProjectContributionStages.projectId,
      roleTitle: profileProjectContributionStages.roleTitle,
      summary: profileProjectContributionStages.summary,
      skills: profileProjectContributionStages.skills,
      visibility: profileProjectContributionStages.visibility,
    });

  if (!stage) return null;

  if (updates.visibility !== undefined) {
    await db
      .update(profileProjectContributions)
      .set({ visibility: updates.visibility, updatedAt: new Date() })
      .where(and(
        eq(profileProjectContributions.id, stage.contributionId),
        eq(profileProjectContributions.profileId, profileId),
        isNull(profileProjectContributions.deletedAt),
      ));
  }

  const [currentStage] = await db
    .select({ id: profileProjectContributionStages.id })
    .from(profileProjectContributionStages)
    .where(and(
      eq(profileProjectContributionStages.id, stageId),
      isNull(profileProjectContributionStages.endedAt),
      isNull(profileProjectContributionStages.deletedAt),
    ))
    .limit(1);

  if (currentStage) {
    await db
      .update(profileProjectContributions)
      .set({
        ...(updates.roleTitle !== undefined ? { roleTitle: stage.roleTitle } : {}),
        ...(updates.summary !== undefined ? { summary: stage.summary } : {}),
        ...(updates.skills !== undefined ? { skills: stage.skills } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(profileProjectContributions.id, stage.contributionId),
        eq(profileProjectContributions.profileId, profileId),
        isNull(profileProjectContributions.deletedAt),
      ));
  }

  await markProfileCollaborationSummaryStale(profileId);
  return stage;
}

export async function markProjectCollaboratorsSummaryStale(projectId: string, executor: DbExecutor = db) {
  if (!projectId) return;
  const rows = await executor
    .select({ profileId: profileProjectContributions.profileId })
    .from(profileProjectContributions)
    .where(and(eq(profileProjectContributions.projectId, projectId), isNull(profileProjectContributions.deletedAt)));
  if (rows.length > 0) {
    await markProfileCollaborationSummaryStale(rows.map((row) => row.profileId), executor);
  }
}
