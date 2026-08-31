import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';

import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { profiles, projects } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { normalizeSocialLinks } from '@/lib/profile/normalization';
import { resolveProjectSocialLinks } from '@/lib/projects/social-links';
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver';
import { assertPublicNetworkUrl } from '@/lib/security/outbound-url';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function blocked(message: string, status = 400, editHref?: string | null) {
    const editHint = editHref ? `<p><a href="${editHref}">Edit this link</a> and try again.</p>` : '<p>You can return to the previous page and choose another link.</p>';
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link unavailable</title></head><body><main><h1>Link unavailable</h1><p>${message}</p>${editHint}</main></body></html>`, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ ownerType: string; ownerId: string; linkKey: string }> },
) {
    const limited = await enforceRouteLimit(request, 'social-link:open', 60, 60, 'publicRead');
    if (limited) return limited;

    const { ownerType, ownerId, linkKey } = await context.params;
    let requestedLinkKey: string;
    try {
        requestedLinkKey = decodeURIComponent(linkKey);
    } catch {
        return blocked('This link is not available.', 404);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    let url: string | null = null;
    let linkPlatform = 'other';
    let editHref: string | null = null;

    if (ownerType === 'profile') {
        const [profile] = await db
            .select({ id: profiles.id, socialLinks: profiles.socialLinks })
            .from(profiles)
            .where(and(eq(profiles.id, ownerId), isNull(profiles.deletedAt)))
            .limit(1);
        if (!profile) return blocked('This link is not available.', 404);

        const relationship = await resolvePrivacyRelationship(user?.id ?? null, profile.id);
        if (user?.id !== profile.id && !relationship?.canViewProfile) {
            return blocked('This link is not available.', 404);
        }
        const link = normalizeSocialLinks({ socialLinks: profile.socialLinks }).find((item) => item.id === requestedLinkKey || item.canonicalKey === requestedLinkKey);
        url = link?.url ?? null;
        linkPlatform = link?.serviceKey ?? link?.platform ?? linkPlatform;
        editHref = user?.id === profile.id ? '/profile' : null;
    } else if (ownerType === 'project') {
        const access = await getProjectAccessById(ownerId, user?.id ?? null);
        if (!access.project || !access.canRead) return blocked('This link is not available.', 404);
        const [project] = await db
            .select({
                externalLinks: projects.externalLinks,
                githubRepoUrl: projects.githubRepoUrl,
                slug: projects.slug,
            })
            .from(projects)
            .where(and(eq(projects.id, ownerId), isNull(projects.deletedAt)))
            .limit(1);
        const link = resolveProjectSocialLinks(project?.externalLinks ?? {}, project?.githubRepoUrl)
            .find((item) => item.id === requestedLinkKey || item.canonicalKey === requestedLinkKey);
        const canViewMemberLinks = access.isOwner || Boolean(access.memberRole);
        if (link?.audience === 'members' && !canViewMemberLinks) {
            return blocked('This link is available to project members only.', 404);
        }
        url = link?.url ?? null;
        linkPlatform = link?.serviceKey ?? link?.platform ?? linkPlatform;
        editHref = access.isOwner
            ? `/projects/${encodeURIComponent(project?.slug || ownerId)}?tab=settings&settings=links`
            : access.memberRole === 'admin'
                ? `/projects/${encodeURIComponent(project?.slug || ownerId)}?tab=settings&settings=links`
                : null;
    } else {
        return blocked('This link is not available.', 404);
    }

    if (!url) return blocked('This link is not available.', 404);

    try {
        // Validate the stored destination without dereferencing it. A server
        // fetch can receive bot/login redirects and silently change the URL
        // the user actually saved.
        const destination = await assertPublicNetworkUrl(url);
        // Privacy-preserving observability: platform/outcome only, never the
        // visitor identity, account label, or destination URL.
        logger.metric('social_link.open', { ownerType, ownerId, kind: linkPlatform, outcome: 'opened' });
        const response = NextResponse.redirect(destination);
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    } catch (error) {
        logger.metric('social_link.open', { ownerType, ownerId, kind: linkPlatform, outcome: 'blocked', failureKind: error instanceof Error ? error.name : 'unknown' });
        return blocked('This link cannot be opened because its destination is not safe.', 400, editHref);
    }
}
