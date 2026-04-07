import type { Project } from '@/types/hub'

export type PublicProjectsCursor = {
    createdAt: string
    id: string
}

export type PublicProjectsFeedItem = {
    id: string
    slug: string | null
    title: string
    description: string | null
    short_description: string | null
    category: string | null
    skills: string[]
    tags: string[]
    status: string | null
    visibility: string | null
    owner_id: string
    view_count: number
    followers_count: number
    saves_count: number
    cover_image: string | null
    created_at: string
    updated_at: string
    open_roles: Array<{
        id: string
        project_id: string
        role: string
        title: string | null
        description: string | null
        count: number
        filled: number
        skills: string[]
    }>
    profiles: {
        id: string
        username: string | null
        full_name: string | null
        avatar_url: string | null
        visibility?: string | null
    }
}

function isValidCursor(value: unknown): value is PublicProjectsCursor {
    return !!value
        && typeof value === 'object'
        && typeof (value as PublicProjectsCursor).createdAt === 'string'
        && typeof (value as PublicProjectsCursor).id === 'string'
}

export function encodePublicProjectsCursor(cursor: PublicProjectsCursor | null): string | null {
    if (!cursor) return null
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodePublicProjectsCursor(cursor: string | null | undefined): PublicProjectsCursor | null {
    if (!cursor) return null

    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
        const parsed = JSON.parse(decoded) as unknown
        return isValidCursor(parsed) ? parsed : null
    } catch {
        return null
    }
}

export function buildPublicProjectsCacheKey(limit: number, cursor: PublicProjectsCursor | null) {
    const suffix = cursor ? `${cursor.createdAt}:${cursor.id}` : 'origin'
    return `projects:public:v3:limit:${limit}:cursor:${suffix}`
}

function normalizeProjectStatus(status: string | null): Project['status'] {
    if (status === 'active' || status === 'completed' || status === 'archived') {
        return status
    }
    return 'draft'
}

export function mapPublicProjectToHubProject(project: PublicProjectsFeedItem): Project {
    const ownerVisibility = project.profiles.visibility || 'public'
    const shouldMaskOwner = ownerVisibility !== 'public'
    return {
        id: project.id,
        slug: project.slug ?? undefined,
        title: project.title,
        description: project.description,
        shortDescription: project.short_description,
        category: project.category,
        skills: Array.isArray(project.skills) ? project.skills : [],
        tags: Array.isArray(project.tags) ? project.tags : [],
        status: normalizeProjectStatus(project.status),
        visibility: project.visibility || 'public',
        viewCount: project.view_count,
        followersCount: project.followers_count,
        savesCount: project.saves_count,
        coverImage: project.cover_image,
        ownerId: project.owner_id,
        owner: {
            id: project.profiles.id,
            username: shouldMaskOwner ? null : project.profiles.username,
            fullName: shouldMaskOwner ? null : project.profiles.full_name,
            avatarUrl: shouldMaskOwner ? null : project.profiles.avatar_url,
            displayName: shouldMaskOwner ? 'Private creator' : (project.profiles.full_name || project.profiles.username || 'Creator'),
            isMasked: shouldMaskOwner,
            canOpenProfile: !shouldMaskOwner,
            badgeText: shouldMaskOwner ? (ownerVisibility === 'connections' ? 'Connections only' : 'Private') : null,
        },
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        collaborators: [],
        openRoles: Array.isArray(project.open_roles)
            ? project.open_roles.map((role) => ({
                id: role.id,
                projectId: role.project_id,
                role: role.role,
                title: role.title,
                description: role.description,
                count: Number(role.count || 0),
                filled: Number(role.filled || 0),
                skills: Array.isArray(role.skills) ? role.skills : [],
            }))
            : [],
        followers: [],
    }
}
