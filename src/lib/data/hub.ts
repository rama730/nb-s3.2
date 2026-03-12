import { cache } from 'react';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { FILTER_VIEWS, SORT_OPTIONS, type FilterView } from '@/constants/hub';
import { db } from '@/lib/db';
import { profiles, projectFollows, projectMembers, projectOpenRoles, projects } from '@/lib/db/schema';
import { recordHubMetric } from '@/lib/hub/observability';
import { HUB_RANKING_SCHEMA_VERSION, getHubRankingWeights } from '@/lib/hub/ranking-config';
import { buildHubSnapshotKey, getHubSnapshotCached } from '@/lib/hub/snapshot-cache';
import { HubFilters, Project } from '@/types/hub';

export const DEFAULT_FILTERS: HubFilters = {
    status: 'all',
    type: 'all',
    tech: [],
    sort: SORT_OPTIONS.NEWEST,
    search: undefined,
    includedIds: undefined,
    hideOpened: false,
};

interface HubQueryOptions {
    view?: FilterView;
    viewerId?: string | null;
}

type ParsedCursor =
    | { kind: 'score'; score: number; createdAt: string; id: string }
    | { kind: 'time'; createdAt: string; id: string }
    | { kind: 'offset'; offset: number }
    | null;

type RawProjectRow = {
    id: string;
    ownerId: string;
    title: string;
    slug: string | null;
    description: string | null;
    shortDescription: string | null;
    coverImage: string | null;
    category: string | null;
    viewCount: number | null;
    followersCount: number | null;

    tags: string[] | null;
    skills: string[] | null;
    visibility: string | null;
    status: string | null;
    lifecycleStages: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    feedScore: number | null;
};

type CandidateProject = {
    id: string;
    ownerId: string;
    title: string;
    description: string | null;
    shortDescription: string | null;
    category: string | null;
    skills: string[] | null;
    tags: string[] | null;
    coverImage: string | null;
    lifecycleStages: string[] | null;
    viewCount: number | null;
    followersCount: number | null;
    updatedAt: Date;
    createdAt: Date;
};

type SnapshotItem = {
    id: string;
    score: number;
    reasons: string[];
};

type SnapshotPayload = {
    items: SnapshotItem[];
};

const MAX_PERSONALIZATION_TERMS = 8;
const MAX_TECH_TERMS = 8;
const MAX_SEARCH_TOKENS = 8;

const normalizeTerm = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9+.#\-\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

const dedupeTerms = (values: Array<string | null | undefined>, max = MAX_PERSONALIZATION_TERMS) => {
    const unique = new Set<string>();
    for (const rawValue of values) {
        if (!rawValue) continue;
        const normalized = normalizeTerm(rawValue);
        if (!normalized || normalized.length < 2) continue;
        unique.add(normalized);
        if (unique.size >= max) break;
    }
    return Array.from(unique);
};

const parseHubCursor = (cursor?: string): ParsedCursor => {
    if (!cursor) return null;

    if (cursor.startsWith('o:')) {
        const offset = Number(cursor.slice(2));
        if (Number.isInteger(offset) && offset >= 0) {
            return { kind: 'offset', offset };
        }
    }

    if (cursor.startsWith('s:')) {
        const [, payload] = cursor.split('s:');
        const [scoreRaw, createdAt, id] = payload.split('|');
        const score = Number(scoreRaw);
        if (Number.isFinite(score) && createdAt && id) {
            return { kind: 'score', score, createdAt, id };
        }
        return null;
    }

    if (cursor.startsWith('t:')) {
        const [, payload] = cursor.split('t:');
        const [createdAt, id] = payload.split('|');
        if (createdAt && id) {
            return { kind: 'time', createdAt, id };
        }
        return null;
    }

    const [createdAt, id] = cursor.split('|');
    if (createdAt && id) {
        return { kind: 'time', createdAt, id };
    }

    return null;
};

const buildTimeCursor = (createdAt: Date, id: string) => `t:${createdAt.toISOString()}|${id}`;
const buildOffsetCursor = (offset: number) => `o:${offset}`;

const buildScoreCursor = (score: number, createdAt: Date, id: string) =>
    `s:${Number.isFinite(score) ? score.toFixed(6) : '0.000000'}|${createdAt.toISOString()}|${id}`;

const isProjectsSelectSchemaError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    return (
        lowered.includes('from "projects"') &&
        ((lowered.includes('column') && lowered.includes('does not exist')) || lowered.includes('failed query'))
    );
};

const getViewerPersonalizationTerms = cache(async (viewerId: string | null | undefined): Promise<string[]> => {
    if (!viewerId) return [];

    const [viewerProfile, followedProjects] = await Promise.all([
        db
            .select({
                skills: profiles.skills,
                interests: profiles.interests,
            })
            .from(profiles)
            .where(eq(profiles.id, viewerId))
            .limit(1),
        db
            .select({
                category: projects.category,
                skills: projects.skills,
                tags: projects.tags,
            })
            .from(projectFollows)
            .innerJoin(projects, eq(projectFollows.projectId, projects.id))
            .where(eq(projectFollows.userId, viewerId))
            .orderBy(desc(projectFollows.createdAt))
            .limit(20)
            .catch(() => []),
    ]);

    const [profile] = viewerProfile;
    const values: string[] = [];

    for (const skill of profile?.skills ?? []) values.push(skill);
    for (const interest of profile?.interests ?? []) values.push(interest);

    for (const followed of followedProjects) {
        if (followed.category) values.push(followed.category);
        for (const skill of followed.skills ?? []) values.push(skill);
        for (const tag of followed.tags ?? []) values.push(tag);
    }

    return dedupeTerms(values, MAX_PERSONALIZATION_TERMS);
});

const buildTermMatchConditions = (terms: string[]) => {
    const conditions: SQL<unknown>[] = [];

    for (const term of terms) {
        const pattern = likePattern(term);
        conditions.push(
            ilike(projects.title, pattern),
            ilike(projects.description, pattern),
            sql<boolean>`EXISTS (SELECT 1 FROM project_skills ps JOIN skills s ON ps.skill_id = s.id WHERE ps.project_id = ${projects.id} AND s.name ILIKE ${pattern})`,
            sql<boolean>`EXISTS (SELECT 1 FROM project_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.project_id = ${projects.id} AND t.name ILIKE ${pattern})`,
            sql<boolean>`lower(coalesce(${projects.category}, '')) LIKE ${pattern}`,
        );
    }

    return conditions;
};

const buildRecommendationRelevanceExpr = (terms: string[]) => {
    const weights = getHubRankingWeights();

    if (terms.length === 0) {
        return sql<number>`0`;
    }

    const clauses = terms.map((term) => {
        const pattern = likePattern(term);
        return sql<number>`(
            CASE WHEN lower(coalesce(${projects.title}, '')) LIKE ${pattern} THEN ${weights.recommendation.titleMatch} ELSE 0 END +
            CASE WHEN lower(coalesce(${projects.description}, '')) LIKE ${pattern} THEN ${weights.recommendation.descriptionMatch} ELSE 0 END +
            CASE WHEN EXISTS (SELECT 1 FROM project_skills ps JOIN skills s ON ps.skill_id = s.id WHERE ps.project_id = ${projects.id} AND s.name ILIKE ${pattern}) THEN ${weights.recommendation.skillsMatch} ELSE 0 END +
            CASE WHEN EXISTS (SELECT 1 FROM project_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.project_id = ${projects.id} AND t.name ILIKE ${pattern}) THEN ${weights.recommendation.tagsMatch} ELSE 0 END +
            CASE WHEN lower(coalesce(${projects.category}, '')) LIKE ${pattern} THEN ${weights.recommendation.categoryMatch} ELSE 0 END
        )`;
    });

    return sql<number>`(${sql.join(clauses, sql` + `)})`;
};

const buildBaseConditions = (
    filters: HubFilters,
    view: FilterView,
    viewerId: string | null,
): SQL<unknown>[] => {
    // CRITICAL: Always exclude soft-deleted projects from every hub query
    const conditions: SQL<unknown>[] = [isNull(projects.deletedAt)];

    if (view !== FILTER_VIEWS.MY_PROJECTS || !viewerId) {
        conditions.push(eq(projects.visibility, 'public'));
    }

    if (view === FILTER_VIEWS.FOLLOWING && viewerId) {
        conditions.push(
            inArray(
                projects.id,
                db
                    .select({ projectId: projectFollows.projectId })
                    .from(projectFollows)
                    .where(eq(projectFollows.userId, viewerId))
            )
        );
    }

    if (filters.status && filters.status !== 'all') {
        conditions.push(eq(projects.status, filters.status as 'draft' | 'active' | 'completed' | 'archived'));
    }

    if (filters.type && filters.type !== 'all') {
        conditions.push(eq(projects.category, filters.type));
    }

    if (filters.search) {
        const normalizedSearchTerms = dedupeTerms(filters.search.split(/\s+/), MAX_SEARCH_TOKENS);
        const searchConditions = buildTermMatchConditions(
            normalizedSearchTerms.length > 0 ? normalizedSearchTerms : [filters.search],
        );
        if (searchConditions.length > 0) {
            conditions.push(or(...searchConditions)!);
        }
    }

    const selectedTechTerms = dedupeTerms(filters.tech, MAX_TECH_TERMS);
    if (selectedTechTerms.length > 0) {
        const techConditions = selectedTechTerms.map((term) =>
            sql<boolean>`EXISTS (SELECT 1 FROM project_skills ps JOIN skills s ON ps.skill_id = s.id WHERE ps.project_id = ${projects.id} AND s.name ILIKE ${likePattern(term)})`,
        );
        conditions.push(or(...techConditions)!);
    }

    if (view === FILTER_VIEWS.MY_PROJECTS && viewerId) {
        conditions.push(
            sql<boolean>`(
                ${projects.ownerId} = ${viewerId}
                OR EXISTS (
                    SELECT 1
                    FROM "project_members" pm
                    WHERE pm.project_id = ${projects.id}
                    AND pm.user_id = ${viewerId}
                )
            )`,
        );
    }

    if (filters.hideOpened && filters.includedIds?.length) {
        conditions.push(
            sql<boolean>`${projects.id} NOT IN (${sql.join(filters.includedIds.map(id => sql`${id}`), sql`, `)})`
        );
    }

    return conditions;
};

const countTextMatches = (value: string, terms: string[]) => {
    if (!value || terms.length === 0) return 0;
    let count = 0;
    const normalized = normalizeTerm(value);
    for (const term of terms) {
        if (normalized.includes(term)) count += 1;
    }
    return count;
};

const countArrayMatches = (values: string[] | null, terms: string[]) => {
    if (!values || terms.length === 0) return 0;
    const normalized = values.map((item) => normalizeTerm(item)).filter(Boolean);
    let count = 0;
    for (const term of terms) {
        if (normalized.some((item) => item.includes(term))) count += 1;
    }
    return count;
};

const calculateTrendScore = (candidate: CandidateProject) => {
    const weights = getHubRankingWeights();
    const views = Math.max(0, candidate.viewCount || 0);
    const follows = Math.max(0, candidate.followersCount || 0);
    const hoursSinceUpdate = Math.max(0, (Date.now() - candidate.updatedAt.getTime()) / (1000 * 60 * 60));
    const recency = Math.max(0, 72 - hoursSinceUpdate);

    return (
        Math.log1p(views) * weights.trending.views +
        Math.log1p(follows) * weights.trending.follows +
        recency * weights.trending.recency
    );
};

const calculateQualityScore = (candidate: CandidateProject) => {
    const weights = getHubRankingWeights();
    const tagsScore = Math.min(1, (candidate.tags?.length || 0) / 6);
    const skillsScore = Math.min(1, (candidate.skills?.length || 0) / 6);
    const lifecycleScore = Math.min(1, (candidate.lifecycleStages?.length || 0) / 5);

    return (
        (candidate.shortDescription ? 1 : 0) * weights.quality.shortDescription +
        (candidate.coverImage ? 1 : 0) * weights.quality.coverImage +
        tagsScore * weights.quality.tags +
        skillsScore * weights.quality.skills +
        lifecycleScore * weights.quality.lifecycle
    );
};

const calculateRecommendationScore = (candidate: CandidateProject, terms: string[]) => {
    const weights = getHubRankingWeights();
    const trendScore = calculateTrendScore(candidate);
    const qualityScore = calculateQualityScore(candidate);

    if (terms.length === 0) {
        return {
            score: trendScore * weights.recommendation.coldStartBlend + qualityScore,
            matchedTerms: 0,
        };
    }

    const titleMatches = countTextMatches(candidate.title, terms);
    const descriptionMatches = countTextMatches(candidate.description || '', terms);
    const skillsMatches = countArrayMatches(candidate.skills, terms);
    const tagsMatches = countArrayMatches(candidate.tags, terms);
    const categoryMatches = countTextMatches(candidate.category || '', terms);

    const relevance =
        titleMatches * weights.recommendation.titleMatch +
        descriptionMatches * weights.recommendation.descriptionMatch +
        skillsMatches * weights.recommendation.skillsMatch +
        tagsMatches * weights.recommendation.tagsMatch +
        categoryMatches * weights.recommendation.categoryMatch;

    return {
        score: relevance + trendScore * weights.recommendation.trendBlend + qualityScore,
        matchedTerms: titleMatches + descriptionMatches + skillsMatches + tagsMatches + categoryMatches,
    };
};

const applyDiversityRerank = (
    entries: Array<{ id: string; score: number; ownerId: string; category: string | null; reasons: string[] }>,
) => {
    const weights = getHubRankingWeights();
    const remaining = [...entries].sort((a, b) => b.score - a.score);
    const reranked: typeof entries = [];
    let lastOwnerId: string | null = null;
    let lastCategory: string | null = null;

    while (remaining.length > 0) {
        let bestIndex = 0;
        let bestAdjusted = Number.NEGATIVE_INFINITY;

        for (let index = 0; index < remaining.length; index += 1) {
            const item = remaining[index];
            let adjusted = item.score;

            if (lastOwnerId && item.ownerId === lastOwnerId) {
                adjusted -= weights.diversity.ownerPenalty;
            }
            if (lastCategory && item.category && item.category === lastCategory) {
                adjusted -= weights.diversity.categoryPenalty;
            }

            if (adjusted > bestAdjusted) {
                bestAdjusted = adjusted;
                bestIndex = index;
            }
        }

        const [chosen] = remaining.splice(bestIndex, 1);
        if (!chosen) break;

        reranked.push(chosen);
        lastOwnerId = chosen.ownerId;
        lastCategory = chosen.category;
    }

    return reranked;
};

const buildReasonLabels = (input: {
    view: FilterView;
    matchedTerms: number;
    trendScore: number;
    qualityScore: number;
    updatedAt: Date;
}) => {
    const reasons: string[] = [];
    const ageHours = (Date.now() - input.updatedAt.getTime()) / (1000 * 60 * 60);

    if (input.view === FILTER_VIEWS.RECOMMENDATIONS && input.matchedTerms > 0) {
        reasons.push('Matches your skills');
    }

    if (input.trendScore >= 3.5) {
        reasons.push('Trending now');
    }

    if (ageHours <= 48) {
        reasons.push('Recently active');
    }

    if (input.qualityScore >= 0.55) {
        reasons.push('Well documented');
    }

    if (reasons.length === 0 && input.view === FILTER_VIEWS.RECOMMENDATIONS) {
        reasons.push('Recommended for you');
    } else if (reasons.length === 0) {
        reasons.push('Popular project');
    }

    return reasons.slice(0, 2);
};

const fetchSnapshotCandidates = async (
    conditions: SQL<unknown>[],
): Promise<CandidateProject[]> => {
    const weights = getHubRankingWeights();

    try {
        return await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                description: projects.description,
                shortDescription: projects.shortDescription,
                category: projects.category,
                skills: projects.skills,
                tags: projects.tags,
                coverImage: projects.coverImage,
                lifecycleStages: projects.lifecycleStages,
                viewCount: projects.viewCount,
                followersCount: projects.followersCount,
                updatedAt: projects.updatedAt,
                createdAt: projects.createdAt,
            })
            .from(projects)
            .where(and(...conditions))
            .orderBy(desc(projects.updatedAt), desc(projects.viewCount), desc(projects.followersCount))
            .limit(weights.candidateLimit);
    } catch (error) {
        if (!isProjectsSelectSchemaError(error)) throw error;

        return db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                description: projects.description,
                shortDescription: sql<string | null>`null`,
                category: projects.category,
                skills: sql<string[] | null>`null`,
                tags: sql<string[] | null>`null`,
                coverImage: sql<string | null>`null`,
                lifecycleStages: sql<string[] | null>`null`,
                viewCount: sql<number | null>`0`,
                followersCount: sql<number | null>`0`,
                updatedAt: projects.updatedAt,
                createdAt: projects.createdAt,
            })
            .from(projects)
            .where(and(...conditions))
            .orderBy(desc(projects.updatedAt), desc(projects.createdAt))
            .limit(weights.candidateLimit);
    }
};

const getFeedSnapshot = async (
    view: FilterView,
    viewerId: string | null,
    filters: HubFilters,
    personalizationTerms: string[],
) => {
    const weights = getHubRankingWeights();
    const cacheKey = buildHubSnapshotKey({
        version: HUB_RANKING_SCHEMA_VERSION,
        view,
        viewerScope: view === FILTER_VIEWS.RECOMMENDATIONS ? viewerId : 'global',
        filters,
        terms: personalizationTerms,
    });

    const { value, cacheHit } = await getHubSnapshotCached<SnapshotPayload>(
        cacheKey,
        weights.snapshotTtlSeconds,
        async () => {
            const candidateConditions = buildBaseConditions(filters, view, viewerId);
            const candidates = await fetchSnapshotCandidates(candidateConditions);

            const scored = candidates.map((candidate) => {
                const trendScore = calculateTrendScore(candidate);
                const qualityScore = calculateQualityScore(candidate);

                if (view === FILTER_VIEWS.RECOMMENDATIONS) {
                    const recommendation = calculateRecommendationScore(candidate, personalizationTerms);
                    return {
                        id: candidate.id,
                        ownerId: candidate.ownerId,
                        category: candidate.category,
                        score: recommendation.score,
                        reasons: buildReasonLabels({
                            view,
                            matchedTerms: recommendation.matchedTerms,
                            trendScore,
                            qualityScore,
                            updatedAt: candidate.updatedAt,
                        }),
                    };
                }

                return {
                    id: candidate.id,
                    ownerId: candidate.ownerId,
                    category: candidate.category,
                    score: trendScore + qualityScore,
                    reasons: buildReasonLabels({
                        view,
                        matchedTerms: 0,
                        trendScore,
                        qualityScore,
                        updatedAt: candidate.updatedAt,
                    }),
                };
            });

            const reranked = applyDiversityRerank(scored)
                .slice(0, weights.maxSnapshotItems)
                .map((entry) => ({
                    id: entry.id,
                    score: entry.score,
                    reasons: entry.reasons,
                }));

            return { items: reranked };
        },
    );

    return { snapshot: value, cacheHit };
};

const fetchProjectsByIds = async (projectIds: string[]) => {
    if (projectIds.length === 0) {
        return {
            rows: [] as RawProjectRow[],
            hasFollowersCountColumn: true,
        };
    }

    let hasFollowersCountColumn = true;

    try {
        const rows = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                slug: projects.slug,
                description: projects.description,
                shortDescription: projects.shortDescription,
                coverImage: projects.coverImage,
                category: projects.category,
                viewCount: projects.viewCount,
                followersCount: projects.followersCount,

                tags: projects.tags,
                skills: projects.skills,
                visibility: projects.visibility,
                status: projects.status,
                lifecycleStages: projects.lifecycleStages,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
                feedScore: sql<number>`0`,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds));

        const rank = new Map(projectIds.map((id, index) => [id, index]));
        rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        return { rows, hasFollowersCountColumn };
    } catch (error) {
        if (!isProjectsSelectSchemaError(error)) throw error;
        hasFollowersCountColumn = false;

        const rows = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                slug: sql<string | null>`null`,
                description: projects.description,
                shortDescription: sql<string | null>`null`,
                coverImage: sql<string | null>`null`,
                category: projects.category,
                viewCount: sql<number | null>`0`,
                followersCount: sql<number | null>`null`,
                savesCount: sql<number | null>`null`,
                tags: sql<string[] | null>`null`,
                skills: sql<string[] | null>`null`,
                visibility: projects.visibility,
                status: projects.status,
                lifecycleStages: sql<string[] | null>`null`,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
                feedScore: sql<number>`0`,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds));

        const rank = new Map(projectIds.map((id, index) => [id, index]));
        rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        return { rows, hasFollowersCountColumn };
    }
};

const hydrateProjects = async (
    rawProjects: RawProjectRow[],
    hasFollowersCountColumn: boolean,
    rankingReasonMap?: Map<string, string[]>,
): Promise<Project[]> => {
    if (rawProjects.length === 0) return [];

    const projectIds = rawProjects.map((project) => project.id);
    const ownerIds = Array.from(new Set(rawProjects.map((project) => project.ownerId)));

    const [owners, roles, members, follows] = await Promise.all([
        db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, ownerIds)),
        db
            .select()
            .from(projectOpenRoles)
            .where(inArray(projectOpenRoles.projectId, projectIds))
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes('project_open_roles') && message.toLowerCase().includes('does not exist')) {
                    return [];
                }
                throw error;
            }),
        db
            .select({
                member: {
                    id: projectMembers.id,
                    projectId: projectMembers.projectId,
                    userId: projectMembers.userId,
                    role: projectMembers.role,
                    joinedAt: projectMembers.joinedAt,
                },
                user: {
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                },
            })
            .from(projectMembers)
            .leftJoin(profiles, eq(projectMembers.userId, profiles.id))
            .where(inArray(projectMembers.projectId, projectIds))
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                if (
                    message.toLowerCase().includes('project_members') &&
                    message.toLowerCase().includes('does not exist')
                ) {
                    return [];
                }
                throw error;
            }),
        hasFollowersCountColumn
            ? Promise.resolve([])
            : db
                .select({ projectId: projectFollows.projectId, count: sql<number>`count(*)` })
                .from(projectFollows)
                .where(inArray(projectFollows.projectId, projectIds))
                .groupBy(projectFollows.projectId),
    ]);

    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const followCountMap = new Map(
        (follows as Array<{ projectId: string; count: number | string | null }>).map((follow) => [
            follow.projectId,
            Number(follow.count || 0),
        ]),
    );


    type OpenRoleRow = typeof projectOpenRoles.$inferSelect;
    const rolesMap = new Map<string, OpenRoleRow[]>();
    (roles as OpenRoleRow[]).forEach((role) => {
        if (!rolesMap.has(role.projectId)) rolesMap.set(role.projectId, []);
        rolesMap.get(role.projectId)!.push(role);
    });

    const membersMap = new Map<
        string,
        Array<{
            member: { id: string; projectId: string; userId: string; role: string; joinedAt: Date };
            user: { id: string; username: string | null; fullName: string | null; avatarUrl: string | null } | null;
        }>
    >();
    members.forEach((member) => {
        if (!membersMap.has(member.member.projectId)) membersMap.set(member.member.projectId, []);
        membersMap.get(member.member.projectId)!.push(member);
    });

    return rawProjects.map((project) => {
        const owner = ownerMap.get(project.ownerId);
        const projectRoles = rolesMap.get(project.id) || [];
        const projectMembersRows = membersMap.get(project.id) || [];

        const followersCount = hasFollowersCountColumn
            ? project.followersCount || 0
            : followCountMap.get(project.id) || 0;


        const normalizedStatus: Project['status'] =
            project.status === 'draft' ||
                project.status === 'active' ||
                project.status === 'completed' ||
                project.status === 'archived'
                ? project.status
                : 'draft';

        return {
            id: project.id,
            title: project.title,
            description: project.description,
            shortDescription: project.shortDescription,
            slug: project.slug || project.id,
            status: normalizedStatus,
            category: project.category,
            coverImage: project.coverImage,
            tags: project.tags || [],
            skills: project.skills || [],
            visibility: project.visibility || 'public',
            viewCount: project.viewCount || 0,
            followersCount,

            ownerId: project.ownerId,
            rankingReasons: rankingReasonMap?.get(project.id) || [],
            owner: owner
                ? {
                    id: owner.id,
                    username: owner.username,
                    fullName: owner.fullName,
                    avatarUrl: owner.avatarUrl,
                }
                : null,
            collaborators: projectMembersRows
                .map((member) =>
                    member.user
                        ? {
                            userId: member.member.userId,
                            membershipRole: member.member.role,
                            user: {
                                id: member.user.id,
                                username: member.user.username,
                                fullName: member.user.fullName,
                                avatarUrl: member.user.avatarUrl,
                            },
                        }
                        : null,
                )
                .filter(Boolean) as Project['collaborators'],
            openRoles: projectRoles.map((role) => ({
                id: role.id,
                role: role.role,
                count: role.count,
                filled: role.filled,
                projectId: role.projectId,
                title: role.title || undefined,
                description: role.description || undefined,
                skills: role.skills || [],
            })),
            followers: [],
            createdAt: project.createdAt.toISOString(),
            updatedAt: project.updatedAt.toISOString(),
        };
    });
};

export const getHubProjects = cache(async (
    filters: HubFilters = DEFAULT_FILTERS,
    cursor?: string,
    pageSize: number = 24,
    options: HubQueryOptions = {},
) => {
    const start = Date.now();
    const view = options.view ?? FILTER_VIEWS.ALL;
    const viewerId = options.viewerId ?? null;

    if ((view === FILTER_VIEWS.MY_PROJECTS || view === FILTER_VIEWS.FOLLOWING) && !viewerId) {
        return {
            projects: [],
            nextCursor: undefined,
            hasMore: false,
            schemaVersion: HUB_RANKING_SCHEMA_VERSION,
        };
    }

    const parsedCursor = parseHubCursor(cursor);
    const viewerType = viewerId ? 'user' : 'anon';
    const filtersFingerprint = buildHubSnapshotKey({ view, filters }).slice(0, 12);

    const personalizationTerms =
        view === FILTER_VIEWS.RECOMMENDATIONS
            ? await getViewerPersonalizationTerms(viewerId)
            : [];

    const shouldUseSnapshot =
        (view === FILTER_VIEWS.TRENDING || view === FILTER_VIEWS.RECOMMENDATIONS) &&
        !filters.includedIds?.length;

    if (shouldUseSnapshot) {
        const offset = parsedCursor?.kind === 'offset' ? parsedCursor.offset : 0;
        const { snapshot, cacheHit } = await getFeedSnapshot(view, viewerId, filters, personalizationTerms);

        const pageItems = snapshot.items.slice(offset, offset + pageSize);
        const pageIds = pageItems.map((item) => item.id);
        const reasonsMap = new Map(pageItems.map((item) => [item.id, item.reasons]));

        const { rows, hasFollowersCountColumn } = await fetchProjectsByIds(pageIds);
        const mappedProjects = await hydrateProjects(rows, hasFollowersCountColumn, reasonsMap);

        const nextOffset = offset + pageSize;
        const nextCursor = nextOffset < snapshot.items.length ? buildOffsetCursor(nextOffset) : undefined;

        recordHubMetric({
            view,
            viewerType,
            durationMs: Date.now() - start,
            projectCount: mappedProjects.length,
            hasMore: !!nextCursor,
            cacheHit,
            strategy: 'snapshot',
            filtersFingerprint,
        });

        return {
            projects: mappedProjects,
            nextCursor,
            hasMore: !!nextCursor,
            schemaVersion: HUB_RANKING_SCHEMA_VERSION,
        };
    }

    const conditions = buildBaseConditions(filters, view, viewerId);

    const weights = getHubRankingWeights();
    const trendingScoreExpr = sql<number>`(
        (ln(1 + greatest(coalesce(${projects.viewCount}, 0), 0)) * ${weights.trending.views}) +
        (ln(1 + greatest(coalesce(${projects.followersCount}, 0), 0)) * ${weights.trending.follows}) +
        (greatest(0, 72 - (extract(epoch from (now() - ${projects.updatedAt})) / 3600.0)) * ${weights.trending.recency})
    )`;

    const recommendationRelevanceExpr = buildRecommendationRelevanceExpr(personalizationTerms);
    const recommendationScoreExpr = sql<number>`(${recommendationRelevanceExpr} + (${trendingScoreExpr} * ${weights.recommendation.trendBlend}))`;

    const normalizedSort = filters.sort || SORT_OPTIONS.NEWEST;
    const shouldUseTrendingScore = view === FILTER_VIEWS.TRENDING || normalizedSort === SORT_OPTIONS.TRENDING;
    const shouldUseRecommendationScore =
        view === FILTER_VIEWS.RECOMMENDATIONS && personalizationTerms.length > 0;

    let scoreExpr: SQL<number> | null = null;
    let isOldestSort = false;

    if (shouldUseRecommendationScore) {
        scoreExpr = recommendationScoreExpr;
    } else if (shouldUseTrendingScore) {
        scoreExpr = trendingScoreExpr;
    } else if (normalizedSort === SORT_OPTIONS.MOST_VIEWED) {
        scoreExpr = sql<number>`coalesce(${projects.viewCount}, 0)::float`;
    } else if (normalizedSort === SORT_OPTIONS.MOST_FOLLOWED) {
        scoreExpr = sql<number>`coalesce(${projects.followersCount}, 0)::float`;
    } else if (normalizedSort === SORT_OPTIONS.OLDEST) {
        isOldestSort = true;
    }

    let scoreCursorCondition: SQL<unknown> | null = null;

    if (scoreExpr && parsedCursor?.kind === 'score') {
        scoreCursorCondition = sql<boolean>`(
            (${scoreExpr}, ${projects.createdAt}, ${projects.id})
            < (${parsedCursor.score}, ${new Date(parsedCursor.createdAt).toISOString()}, ${parsedCursor.id})
        )`;
        conditions.push(scoreCursorCondition);
    } else if (!scoreExpr && parsedCursor?.kind === 'time') {
        const operator = isOldestSort ? sql`>` : sql`<`;
        conditions.push(
            sql<boolean>`(
                (${projects.createdAt}, ${projects.id})
                ${operator}
                (${new Date(parsedCursor.createdAt).toISOString()}, ${parsedCursor.id})
            )`,
        );
    }

    const orderByClauses: SQL<unknown>[] = scoreExpr
        ? [sql`${scoreExpr} DESC`, desc(projects.createdAt), desc(projects.id)]
        : isOldestSort
            ? [asc(projects.createdAt), asc(projects.id)]
            : [desc(projects.createdAt), desc(projects.id)];

    let rawProjects: RawProjectRow[];
    let hasFollowersCountColumn = true;


    try {
        rawProjects = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                slug: projects.slug,
                description: projects.description,
                shortDescription: projects.shortDescription,
                coverImage: projects.coverImage,
                category: projects.category,
                viewCount: projects.viewCount,
                followersCount: projects.followersCount,
                tags: projects.tags,
                skills: projects.skills,
                visibility: projects.visibility,
                status: projects.status,
                lifecycleStages: projects.lifecycleStages,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
                feedScore: scoreExpr ?? sql<number>`0`,
            })
            .from(projects)
            .where(and(...conditions))
            .orderBy(...orderByClauses)
            .limit(pageSize);
    } catch (error) {
        if (!isProjectsSelectSchemaError(error)) throw error;

        hasFollowersCountColumn = false;

        const fallbackOrderBy: SQL<unknown>[] = isOldestSort
            ? [asc(projects.createdAt), asc(projects.id)]
            : [desc(projects.createdAt), desc(projects.id)];

        const fallbackConditions =
            scoreCursorCondition === null
                ? conditions
                : conditions.filter((condition) => condition !== scoreCursorCondition);

        rawProjects = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                slug: sql<string | null>`null`,
                description: projects.description,
                shortDescription: sql<string | null>`null`,
                coverImage: sql<string | null>`null`,
                category: projects.category,
                viewCount: sql<number | null>`null`,
                followersCount: sql<number | null>`null`,
                tags: sql<string[] | null>`null`,
                skills: sql<string[] | null>`null`,
                visibility: projects.visibility,
                status: projects.status,
                lifecycleStages: sql<string[] | null>`null`,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
                feedScore: sql<number>`0`,
            })
            .from(projects)
            .where(and(...fallbackConditions))
            .orderBy(...fallbackOrderBy)
            .limit(pageSize);
    }

    const mappedProjects = await hydrateProjects(rawProjects, hasFollowersCountColumn);
    const lastProject = rawProjects[rawProjects.length - 1];
    const nextCursor = rawProjects.length === pageSize
        ? scoreExpr && lastProject
            ? buildScoreCursor(Number(lastProject.feedScore || 0), lastProject.createdAt, lastProject.id)
            : lastProject
                ? buildTimeCursor(lastProject.createdAt, lastProject.id)
                : undefined
        : undefined;

    recordHubMetric({
        view,
        viewerType,
        durationMs: Date.now() - start,
        projectCount: mappedProjects.length,
        hasMore: !!nextCursor,
        cacheHit: false,
        strategy: 'direct',
        filtersFingerprint,
    });

    return {
        projects: mappedProjects,
        nextCursor,
        hasMore: rawProjects.length === pageSize,
        schemaVersion: HUB_RANKING_SCHEMA_VERSION,
    };
});
