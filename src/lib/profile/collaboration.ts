import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  profileCollaborationSummaries,
  profileContributionSkills,
  profileProjectContributionStages,
  profileProjectContributions,
  profiles,
  projectInvitations,
  projects,
  roleApplications,
  skills,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { normalizeProjectDescription, normalizeProjectTitle, trimDisplayText, trimOptionalDisplayText } from "@/lib/profile/display";
import { syncContributionSkills } from "@/lib/skills/service";
import { formatProjectTeamRole } from "@/lib/projects/settings-policies";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { containsLikePattern, normalizeSearchQuery } from "@/lib/search/query";
import { isUuid } from "@/lib/validations/uuid";

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
  contributionVisibility: "public" | "private";
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
};

export type ProfileCollaborationContribution = {
  id: string;
  projectId: string | null;
  externalKey?: string | null;
  version?: number;
  title: string;
  projectTitle: string;
  projectHref: string | null;
  projectUrl?: string | null;
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
  visibility?: "public" | "private";
};

export type ProfileCollaborationSummary = {
  version: number;
  generatedAt: string;
  projects: ProfileCollaborationProject[];
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
  lead_focus: string | null;
  contribution_summary: string | null;
  contribution_skills: unknown;
  member_previews: unknown;
  total_count: number | string;
};

type ProfileContributionRow = {
  contribution_id: string;
  project_id: string | null;
  external_key: string | null;
  version: number | string;
  project_title_override: string | null;
  project_url: string | null;
  repository_url: string | null;
  project_title: string | null;
  project_slug: string | null;
  project_visibility: string | null;
  project_status: string | null;
  project_owner_id: string | null;
  membership_role: string | null;
  accepted_role_title: string | null;
  lead_focus: string | null;
  role_kind: string;
  role_title: string | null;
  summary: string | null;
  canonical_skills: unknown;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  source: string;
  verified_at: Date | string | null;
  visibility: "public" | "private";
  role_stages: unknown;
  total_count: number | string;
};

const SUMMARY_VERSION = 5;
const SUMMARY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 12;
const EMPTY_SUMMARY: ProfileCollaborationSummary = {
  version: SUMMARY_VERSION,
  generatedAt: "",
  projects: [],
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
  const roleKind = trimDisplayText(row.user_role) || (row.owner_id ? "member" : "contributor");
  const projectRoleTitle = trimDisplayText(row.contribution_role_title) || trimDisplayText(row.accepted_role_title);
  if (!['owner', 'admin', 'member', 'viewer'].includes(roleKind)) {
    return projectRoleTitle || defaultRoleTitle(roleKind);
  }
  return formatProjectTeamRole({
    membershipRole: roleKind,
    projectRoleTitle,
    leadFocus: row.lead_focus,
  });
}

function roleStageFromObject(stage: Record<string, unknown>, fallbackContributionId: string | null): ProfileCollaborationRoleStage | null {
  const id = trimDisplayText(stage.id);
  const roleKind = trimDisplayText(stage.roleKind) || trimDisplayText(stage.role_kind) || "contributor";
  const roleTitle = trimDisplayText(stage.roleTitle) || trimDisplayText(stage.role_title) || defaultRoleTitle(roleKind);
  if (!id && !roleTitle) return null;
  const endedAt = toIsoDate((stage.endedAt ?? stage.ended_at) as Date | string | null | undefined);
  const verifiedAt = toIsoDate((stage.verifiedAt ?? stage.verified_at) as Date | string | null | undefined);
  const currentlyActive = !endedAt;
  return {
    id: id || `${fallbackContributionId ?? "manual"}:${roleTitle}`,
    contributionId: trimOptionalDisplayText(stage.contributionId ?? stage.contribution_id) ?? fallbackContributionId,
    roleKind,
    roleTitle,
    summary: trimOptionalDisplayText(stage.summary),
    // Stage-specific JSON skills are retired. The normalized contribution edge
    // is applied after parsing so one relational source drives every stage.
    skills: [],
    startDate: toShortDate((stage.startedAt ?? stage.started_at) as Date | string | null | undefined),
    endDate: toShortDate((stage.endedAt ?? stage.ended_at) as Date | string | null | undefined),
    startedAt: toIsoDate((stage.startedAt ?? stage.started_at) as Date | string | null | undefined),
    endedAt,
    currentlyActive,
    source: trimDisplayText(stage.source) || "membership",
    verified: Boolean(verifiedAt),
    verifiedAt,
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
    contributionVisibility: row.contribution_visibility === "private" ? "private" : "public",
    status: trimOptionalDisplayText(row.status),
    skills: stringArray(row.contribution_skills).length ? stringArray(row.contribution_skills) : stringArray(row.skills),
    tags: stringArray(row.tags),
    verified: true,
  };
}

function contributionRoleLabel(row: ProfileContributionRow) {
  if (!row.project_id) return trimDisplayText(row.role_title) || "Contributor";
  const membershipRole = trimDisplayText(row.membership_role) || trimDisplayText(row.role_kind) || "member";
  const projectRoleTitle = trimOptionalDisplayText(row.role_title) ?? trimOptionalDisplayText(row.accepted_role_title);
  if (!["owner", "admin", "member", "viewer"].includes(membershipRole)) {
    return projectRoleTitle || defaultRoleTitle(membershipRole);
  }
  return formatProjectTeamRole({ membershipRole, projectRoleTitle, leadFocus: row.lead_focus });
}

function contributionFromRow(row: ProfileContributionRow): ProfileCollaborationContribution {
  const visibility: "public" | "private" = row.visibility === "private" ? "private" : "public";
  const contributionSkills = stringArray(row.canonical_skills);
  const formattedRole = contributionRoleLabel(row);
  const stages = roleStages(row.role_stages, row.contribution_id).map((stage) => ({
    ...stage,
    skills: contributionSkills,
  }));
  const fallbackStage: ProfileCollaborationRoleStage = {
    id: `${row.contribution_id}:current`,
    contributionId: row.contribution_id,
    roleKind: trimDisplayText(row.role_kind) || "contributor",
    roleTitle: formattedRole,
    summary: trimOptionalDisplayText(row.summary),
    skills: contributionSkills,
    startDate: toShortDate(row.started_at),
    endDate: toShortDate(row.ended_at),
    startedAt: toIsoDate(row.started_at),
    endedAt: toIsoDate(row.ended_at),
    currentlyActive: !row.ended_at,
    source: trimDisplayText(row.source) || "membership",
    verified: Boolean(row.verified_at),
    verifiedAt: toIsoDate(row.verified_at),
  };
  const normalizedStages = stages.length ? stages : [fallbackStage];
  const activeStage = normalizedStages.find((stage) => stage.currentlyActive) ?? normalizedStages[0] ?? fallbackStage;
  const projectTitle = row.project_id
    ? normalizeProjectTitle(row.project_title)
    : trimDisplayText(row.project_title_override) || "External project";
  const projectHref = row.project_id
    ? buildProjectHref({ id: row.project_id, slug: row.project_slug })
    : trimOptionalDisplayText(row.project_url);
  return {
    id: row.contribution_id,
    projectId: row.project_id,
    externalKey: row.external_key,
    version: Number(row.version) || 1,
    title: row.project_id ? formattedRole : activeStage.roleTitle,
    projectTitle,
    projectHref,
    projectUrl: trimOptionalDisplayText(row.project_url),
    repoUrl: trimOptionalDisplayText(row.repository_url),
    description: trimOptionalDisplayText(row.summary) ?? activeStage.summary,
    startDate: toShortDate(row.started_at),
    endDate: toShortDate(row.ended_at),
    currentlyActive: !row.ended_at,
    skills: contributionSkills,
    source: trimDisplayText(row.source) || "membership",
    verified: Boolean(row.verified_at) || Boolean(row.project_id),
    roleKind: trimDisplayText(row.role_kind) || "contributor",
    roleStages: normalizedStages,
    visibility,
  };
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
        NULLIF(p.import_source->'metadata'->>'leadFocus', '') AS lead_focus,
        pc.summary AS contribution_summary,
        COALESCE(pc_skills.labels, '[]'::jsonb) AS contribution_skills,
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
        SELECT jsonb_agg(skill.name ORDER BY edge.display_order, skill.name) AS labels
        FROM ${profileContributionSkills} edge
        INNER JOIN ${skills} skill ON skill.id = edge.skill_id
        WHERE edge.contribution_id = pc.id
          AND skill.status NOT IN ('hidden', 'merged')
      ) pc_skills ON true
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
      COALESCE(members.member_previews, '[]'::jsonb) AS member_previews
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
    ORDER BY ps.view_count DESC NULLS LAST, ps.updated_at DESC, ps.created_at DESC, ps.project_id DESC
  `);

  return Array.from(rows);
}

async function queryProfileContributionRows(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
  stageLimit?: number;
}) {
  const includePrivate = Boolean(options.includePrivate);
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const stageLimit = Math.min(Math.max(options.stageLimit ?? 8, 1), 20);
  const rows = await db.execute<ProfileContributionRow>(sql`
    SELECT
      contribution.id AS contribution_id,
      contribution.project_id,
      contribution.external_key,
      contribution.version,
      contribution.project_title AS project_title_override,
      contribution.project_url,
      contribution.repository_url,
      project.title AS project_title,
      project.slug AS project_slug,
      project.visibility AS project_visibility,
      project.status AS project_status,
      project.owner_id AS project_owner_id,
      CASE
        WHEN project.owner_id = ${profileId} THEN 'owner'
        ELSE member.role
      END AS membership_role,
      application.accepted_role_title,
      NULLIF(project.import_source->'metadata'->>'leadFocus', '') AS lead_focus,
      contribution.role_kind,
      contribution.role_title,
      contribution.summary,
      COALESCE(contribution_skills.labels, '[]'::jsonb) AS canonical_skills,
      contribution.started_at,
      contribution.ended_at,
      contribution.source,
      contribution.verified_at,
      contribution.visibility,
      COALESCE(stages.role_stages, '[]'::jsonb) AS role_stages,
      count(*) OVER()::int AS total_count
    FROM ${profileProjectContributions} contribution
    LEFT JOIN ${projects} project
      ON project.id = contribution.project_id
     AND project.deleted_at IS NULL
    LEFT JOIN project_members member
      ON member.project_id = contribution.project_id
     AND member.user_id = ${profileId}
    LEFT JOIN LATERAL (
      SELECT accepted_role_title
      FROM ${roleApplications}
      WHERE project_id = contribution.project_id
        AND applicant_id = ${profileId}
        AND status = 'accepted'
      ORDER BY updated_at DESC
      LIMIT 1
    ) application ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(skill.name ORDER BY edge.display_order, skill.name) AS labels
      FROM ${profileContributionSkills} edge
      INNER JOIN ${skills} skill ON skill.id = edge.skill_id
      WHERE edge.contribution_id = contribution.id
        AND skill.status NOT IN ('hidden', 'merged')
    ) contribution_skills ON true
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id', ranked.id,
            'contributionId', ranked.contribution_id,
            'roleKind', ranked.role_kind,
            'roleTitle', ranked.role_title,
            'summary', ranked.summary,
            'startedAt', ranked.started_at,
            'endedAt', ranked.ended_at,
            'source', ranked.source,
            'verifiedAt', ranked.verified_at
          ) ORDER BY ranked.stage_rank
        ) AS role_stages
      FROM (
        SELECT
          stage.*,
          row_number() OVER (
            ORDER BY CASE WHEN stage.ended_at IS NULL THEN 0 ELSE 1 END,
              stage.started_at DESC NULLS LAST, stage.created_at DESC, stage.id DESC
          ) AS stage_rank
        FROM ${profileProjectContributionStages} stage
        WHERE stage.contribution_id = contribution.id
          AND stage.deleted_at IS NULL
        ORDER BY CASE WHEN stage.ended_at IS NULL THEN 0 ELSE 1 END,
          stage.started_at DESC NULLS LAST, stage.created_at DESC, stage.id DESC
        LIMIT ${stageLimit}
      ) ranked
    ) stages ON true
    WHERE contribution.profile_id = ${profileId}
      AND contribution.deleted_at IS NULL
      AND (${includePrivate ? sql`TRUE` : sql`contribution.visibility = 'public'`})
      AND (
        contribution.project_id IS NULL
        OR (
          project.id IS NOT NULL
          AND (${includePrivate ? sql`TRUE` : sql`project.visibility IN ('public', 'unlisted') AND project.status <> 'draft'`})
        )
      )
    ORDER BY
      CASE WHEN contribution.ended_at IS NULL THEN 0 ELSE 1 END,
      contribution.started_at DESC NULLS LAST,
      contribution.updated_at DESC,
      contribution.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return Array.from(rows);
}

function buildSummaryFromRows(
  projectRows: ProfileProjectRow[],
  contributionRows: ProfileContributionRow[],
): ProfileCollaborationSummary {
  const projectsList = projectRows.map(projectFromRow);
  const contributions = contributionRows.map(contributionFromRow);
  const projectsCount = Number(projectRows[0]?.total_count ?? projectsList.length);
  const contributionCount = Number(contributionRows[0]?.total_count ?? contributions.length);

  return {
    version: SUMMARY_VERSION,
    generatedAt: nowIso(),
    projects: projectsList.slice(0, 4),
    contributions,
    stats: {
      projectsCount,
      visibleProjectsCount: projectsCount,
      contributionCount,
    },
  };
}

async function writePublicSummary(
  profileId: string,
  summary: ProfileCollaborationSummary,
  generationStartedAt: Date,
) {
  const writtenAt = new Date();
  const written = await db
    .insert(profileCollaborationSummaries)
    .values({
      profileId,
      version: SUMMARY_VERSION,
      summary,
      projectCount: summary.stats.projectsCount,
      visibleProjectCount: summary.stats.visibleProjectsCount,
      contributionCount: summary.stats.contributionCount,
      stale: false,
      refreshedAt: writtenAt,
      updatedAt: writtenAt,
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
        refreshedAt: writtenAt,
        updatedAt: writtenAt,
      },
      // A mutation may mark this row stale while the read query is running.
      // Never let an older snapshot overwrite that newer invalidation.
      where: lt(profileCollaborationSummaries.updatedAt, generationStartedAt),
    })
    .returning({ profileId: profileCollaborationSummaries.profileId });
  return written.length > 0;
}

export async function getProfileCollaborationSummary(profileId: string, options: {
  includePrivate?: boolean;
  preferCached?: boolean;
  maxAgeMs?: number;
} = {}): Promise<ProfileCollaborationSummary> {
  const includePrivate = Boolean(options.includePrivate);
  const preferCached = options.preferCached !== false && !includePrivate;
  const maxAgeMs = options.maxAgeMs ?? SUMMARY_TTL_MS;
  const dedupeKey = `profile-collaboration:${profileId}:${includePrivate ? "owner" : "public"}:${preferCached}:${maxAgeMs}`;
  return runInFlightDeduped(dedupeKey, () => readProfileCollaborationSummary(profileId, {
    includePrivate,
    preferCached,
    maxAgeMs,
  }));
}

async function readProfileCollaborationSummary(profileId: string, options: {
  includePrivate: boolean;
  preferCached: boolean;
  maxAgeMs: number;
}): Promise<ProfileCollaborationSummary> {
  const startedAt = Date.now();
  const generationStartedAt = new Date(startedAt);
  const { includePrivate, preferCached, maxAgeMs } = options;

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

  const [projectRows, contributionRows] = await Promise.all([
    queryProfileProjectRows(profileId, { includePrivate, limit: DEFAULT_LIMIT, offset: 0 }),
    queryProfileContributionRows(profileId, { includePrivate, limit: 24, offset: 0, stageLimit: 8 }),
  ]);
  const summary = buildSummaryFromRows(projectRows, contributionRows);

  if (!includePrivate) {
    const cacheWritten = await writePublicSummary(profileId, summary, generationStartedAt);
    if (!cacheWritten) {
      logger.metric("profile.collaboration.cache_write_skipped", {
        profileId,
        reason: "newer_invalidation",
      });
    }
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

export async function getProfileContributions(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
  stageLimit?: number;
} = {}) {
  const startedAt = Date.now();
  const rows = await queryProfileContributionRows(profileId, options);
  const contributions = rows.map(contributionFromRow);
  const total = Number(rows[0]?.total_count ?? contributions.length);
  logger.metric("profile.collaboration.contributions", {
    profileId,
    includePrivate: Boolean(options.includePrivate),
    count: contributions.length,
    total,
    durationMs: Date.now() - startedAt,
  });
  return {
    contributions,
    total,
    hasMore: (options.offset ?? 0) + contributions.length < total,
  };
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

export async function getProfileInviteProjectOptions(
  inviterId: string,
  targetProfileId: string,
  input: { search?: string; cursor?: string; limit?: number; projectId?: string } = {},
): Promise<{ projects: ProfileInviteProjectOption[]; nextCursor: string | null }> {
  if (!inviterId || !targetProfileId || inviterId === targetProfileId) return { projects: [], nextCursor: null };
  const requestedLimit = Number(input.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 50)) : 20;
  const search = normalizeSearchQuery(input.search, 100);
  const separator = input.cursor?.indexOf("|") ?? -1;
  const cursorDate = separator > 0 ? new Date(input.cursor!.slice(0, separator)) : null;
  const cursorId = separator > 0 ? input.cursor!.slice(separator + 1) : null;
  const cursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId && isUuid(cursorId)
    ? { updatedAt: cursorDate, id: cursorId }
    : null;
  const rows = await db.execute<{
    id: string;
    title: string | null;
    slug: string | null;
    role: "owner" | "admin";
    updatedAt: Date | string;
  }>(sql`
    SELECT p.id, p.title, p.slug,
           CASE WHEN p.owner_id = ${inviterId} THEN 'owner' ELSE pm.role END AS role,
           p.updated_at AS "updatedAt"
    FROM ${projects} p
    LEFT JOIN project_members pm
      ON pm.project_id = p.id
     AND pm.user_id = ${inviterId}
    LEFT JOIN project_members target_pm
      ON target_pm.project_id = p.id
     AND target_pm.user_id = ${targetProfileId}
    WHERE p.deleted_at IS NULL
      AND target_pm.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${roleApplications} pending_application
        WHERE pending_application.project_id = p.id
          AND pending_application.applicant_id = ${targetProfileId}
          AND pending_application.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${projectInvitations} pending_invitation
        WHERE pending_invitation.project_id = p.id
          AND pending_invitation.candidate_id = ${targetProfileId}
          AND pending_invitation.status = 'pending'
          AND pending_invitation.expires_at > now()
      )
      AND (
        p.owner_id = ${inviterId}
        OR pm.role IN ('owner', 'admin')
      )
      ${input.projectId ? sql`AND p.id = ${input.projectId}::uuid` : sql``}
      ${search ? sql`AND p.title ILIKE ${containsLikePattern(search)} ESCAPE '\\'` : sql``}
      ${cursor ? sql`AND (p.updated_at, p.id) < (${cursor.updatedAt}, ${cursor.id}::uuid)` : sql``}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ${limit + 1}
  `);

  const page = Array.from(rows);
  const visible = page.slice(0, limit);
  const last = visible.at(-1);
  return {
    projects: visible.map((row) => ({
    id: row.id,
    title: normalizeProjectTitle(row.title),
    slug: row.slug,
    role: row.role === "admin" ? "admin" : "owner",
    href: buildProjectHref({ id: row.id, slug: row.slug }),
    })),
    nextCursor: page.length > limit && last ? `${new Date(last.updatedAt).toISOString()}|${last.id}` : null,
  };
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
    await syncContributionSkills(executor, contribution.id, stringArray(contribution.skills), params.profileId);
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
