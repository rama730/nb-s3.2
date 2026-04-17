import { notFound, permanentRedirect } from 'next/navigation';
import { getProfileDetails, getPublicProfileMeta } from '@/lib/data/profile';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';
import { Metadata } from 'next';
import { resolvePublicUsernameRoute } from '@/lib/usernames/service';
import { buildRouteMetadata, DEFAULT_ROUTE_OG_IMAGE } from '@/lib/metadata/route-metadata';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { buildProfileMetadataDescription, buildPublicProfileTitle } from '@/lib/profile/display';

export const dynamic = 'force-dynamic';
export const dynamicParams = true; // Allow new profiles to be generated on demand

function decodeUsernameParam(username: string): string | null {
    try {
        return decodeURIComponent(username);
    } catch {
        return null;
    }
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
    const { username } = await params;
    const decodedUsername = decodeUsernameParam(username);
    if (!decodedUsername) {
        return buildRouteMetadata({
            title: 'Profile Not Found | Edge',
            description: 'The requested profile could not be found.',
            path: `/u/${encodeURIComponent(username)}`,
        });
    }

    const route = await resolvePublicUsernameRoute({ username: decodedUsername });
    if (route.status === 'not_found') {
        return buildRouteMetadata({
            title: 'Profile Not Found | Edge',
            description: 'The requested profile could not be found.',
            path: `/u/${encodeURIComponent(decodedUsername)}`,
        });
    }

    const data = await getPublicProfileMeta(route.currentUsername);

    if (!data) {
        return buildRouteMetadata({
            title: 'Profile Not Found | Edge',
            description: 'The requested profile could not be found.',
            path: `/u/${encodeURIComponent(route.currentUsername)}`,
        });
    }

    return buildRouteMetadata({
        title: buildPublicProfileTitle({
            username: data.username,
            fullName: data.fullName,
        }),
        description: buildProfileMetadataDescription({
            username: data.username,
            fullName: data.fullName,
            headline: data.headline,
            location: data.location,
            bio: data.bio,
        }),
        path: `/u/${encodeURIComponent(data.username ?? route.currentUsername)}`,
        image: data.avatarUrl || DEFAULT_ROUTE_OG_IMAGE,
    });
}

export default async function PublicProfilePage({
    params,
    searchParams,
}: {
    params: Promise<{ username: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { username } = await params;
    const resolvedSearchParams = (await searchParams) ?? {};
    const viewerPreviewMode =
        typeof resolvedSearchParams.viewer === 'string' && resolvedSearchParams.viewer === 'visitor';

    const decodedUsername = decodeUsernameParam(username);
    if (!decodedUsername) {
        notFound();
    }

    const route = await resolvePublicUsernameRoute({ username: decodedUsername });
    if (route.status === 'not_found') {
        notFound();
    }
    if (route.status === 'redirect') {
        permanentRedirect(`/u/${encodeURIComponent(route.currentUsername)}`);
    }

    const viewerAuth = viewerPreviewMode ? null : await getViewerAuthContext();
    const data = await getProfileDetails(route.currentUsername, {
        viewerUser: viewerAuth?.user ?? null,
    });

    if (data.privacyStatus === 'not_found' || !data.profile) {
        notFound();
    }

    // Pass data to the Client Component
    // connectionStatus, isOwner, stats etc are all calculated by getProfileDetails
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-zinc-50 dark:bg-black"
        >
            <ProfileV2Client
                profile={data.profile}
                stats={data.stats}
                isOwner={data.isOwner}
                currentUser={data.currentUser}
                connectionStatus={data.connectionStatus}
                privacyRelationship={data.privacyRelationship}
                lockedShell={data.lockedShell}
                projects={data.projects}
                viewerPreviewMode={viewerPreviewMode}
            />
        </div>
    );
}
