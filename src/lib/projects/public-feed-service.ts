import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { profiles, projects } from '@/lib/db/schema'
import { getCacheEnvelope, cacheStaleableData } from '@/lib/redis'
import {
    buildPublicProjectsCacheKey,
    encodePublicProjectsCursor,
    type PublicProjectsCursor,
    type PublicProjectsFeedItem,
} from '@/lib/projects/public-feed'

export const PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT = 24
export const PUBLIC_PROJECTS_FEED_MAX_LIMIT = 100
export const PUBLIC_PROJECTS_FEED_FRESH_TTL_SECONDS = 60
export const PUBLIC_PROJECTS_FEED_STALE_TTL_SECONDS = 300

type PublicProjectRow = {
    id: string
    slug: string | null
    title: string
    description: string | null
    shortDescription: string | null
    category: string | null
    skills: string[] | null
    tags: string[] | null
    status: string | null
    visibility: string | null
    ownerId: string
    viewCount: number | null
    followersCount: number
    savesCount: number | null
    coverImage: string | null
    createdAt: Date
    updatedAt: Date
    profiles: {
        id: string
        username: string | null
        full_name: string | null
        avatar_url: string | null
        visibility: string | null
    }
}

export type PublicProjectsFeedPage = {
    projects: PublicProjectsFeedItem[]
    nextCursor: string | null
    source: 'redis' | 'redis-stale' | 'database'
    cacheState: 'fresh' | 'stale' | 'miss'
}

function mapProjectRow(row: PublicProjectRow): PublicProjectsFeedItem {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        short_description: row.shortDescription,
        category: row.category,
        skills: row.skills ?? [],
        tags: row.tags ?? [],
        status: row.status,
        visibility: row.visibility,
        owner_id: row.ownerId,
        view_count: row.viewCount ?? 0,
        followers_count: row.followersCount ?? 0,
        saves_count: row.savesCount ?? 0,
        cover_image: row.coverImage,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        profiles: row.profiles,
    }
}

export async function readPublicProjectsFeedCache(limit: number, cursor: PublicProjectsCursor | null) {
    const cacheKey = buildPublicProjectsCacheKey(limit, cursor)
    const cached = await getCacheEnvelope<{
        projects: PublicProjectsFeedItem[]
        nextCursor: string | null
    }>(cacheKey)

    return {
        cacheKey,
        fresh: cached && (!cached.staleAt || cached.staleAt > Date.now()) ? cached : null,
        stale: cached && (!cached.expiresAt || cached.expiresAt > Date.now()) ? cached : null,
    }
}

export async function queryAndCachePublicProjectsFeed(limit: number, cursor: PublicProjectsCursor | null) {
    const rows = await db
        .select({
            id: projects.id,
            slug: projects.slug,
            title: projects.title,
            description: projects.description,
            shortDescription: projects.shortDescription,
            category: projects.category,
            skills: projects.skills,
            tags: projects.tags,
            status: projects.status,
            visibility: projects.visibility,
            ownerId: projects.ownerId,
            viewCount: projects.viewCount,
            followersCount: projects.followersCount,
            savesCount: projects.savesCount,
            coverImage: projects.coverImage,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            profiles: {
                id: profiles.id,
                username: profiles.username,
                full_name: profiles.fullName,
                avatar_url: profiles.avatarUrl,
                visibility: profiles.visibility,
            },
        })
        .from(projects)
        .innerJoin(profiles, eq(projects.ownerId, profiles.id))
        .where(
            and(
                eq(projects.visibility, 'public'),
                isNull(projects.deletedAt),
                cursor
                    ? or(
                        lt(projects.createdAt, new Date(cursor.createdAt)),
                        and(
                            eq(projects.createdAt, new Date(cursor.createdAt)),
                            sql<boolean>`${projects.id} < ${cursor.id}`,
                        ),
                    )
                    : undefined,
            ),
        )
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(limit + 1)

    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit) as PublicProjectRow[]
    const lastRow = pageRows.at(-1) ?? null
    const nextCursor = hasMore && lastRow
        ? encodePublicProjectsCursor({
            createdAt: lastRow.createdAt.toISOString(),
            id: lastRow.id,
        })
        : null
    const payload = {
        projects: pageRows.map(mapProjectRow),
        nextCursor,
    }

    await cacheStaleableData(
        buildPublicProjectsCacheKey(limit, cursor),
        payload,
        {
            freshTtlSeconds: PUBLIC_PROJECTS_FEED_FRESH_TTL_SECONDS,
            staleTtlSeconds: PUBLIC_PROJECTS_FEED_STALE_TTL_SECONDS,
        },
    )

    return payload
}

export async function getPublicProjectsFeedPage(limit: number, cursor: PublicProjectsCursor | null): Promise<PublicProjectsFeedPage> {
    const normalizedLimit = Math.min(
        Math.max(1, Math.trunc(limit || PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT)),
        PUBLIC_PROJECTS_FEED_MAX_LIMIT,
    )
    const cached = await readPublicProjectsFeedCache(normalizedLimit, cursor)

    if (cached.fresh) {
        return {
            projects: cached.fresh.value.projects,
            nextCursor: cached.fresh.value.nextCursor,
            source: 'redis',
            cacheState: 'fresh',
        }
    }

    try {
        const payload = await queryAndCachePublicProjectsFeed(normalizedLimit, cursor)
        return {
            ...payload,
            source: 'database',
            cacheState: 'miss',
        }
    } catch (error) {
        if (cached.stale) {
            return {
                projects: cached.stale.value.projects,
                nextCursor: cached.stale.value.nextCursor,
                source: 'redis-stale',
                cacheState: 'stale',
            }
        }
        throw error
    }
}
