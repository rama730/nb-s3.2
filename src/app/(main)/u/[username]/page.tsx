import { notFound, permanentRedirect } from 'next/navigation';
import { getProfileDetails } from '@/lib/data/profile';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';
import { Metadata } from 'next';
import { Suspense } from 'react';
import { resolvePublicUsernameRoute } from '@/lib/usernames/service';
import { buildRouteMetadata, DEFAULT_ROUTE_OG_IMAGE } from '@/lib/metadata/route-metadata';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { buildProfileMetadataDescription, buildPublicProfileTitle } from '@/lib/profile/display';
import { getProfileProjectsWithOpenRolesAction } from '@/app/actions/project';

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

    const viewerAuth = await getViewerAuthContext();
    const data = await getProfileDetails(route.currentUsername, {
        viewerUser: viewerAuth.user ?? null,
        skipHeavyData: true,
        recordViewEvent: false,
    });

    if (data.privacyStatus === 'not_found' || !data.profile || data.lockedShell) {
        return buildRouteMetadata({
            title: 'Profile Not Found | Edge',
            description: 'The requested profile could not be found.',
            path: `/u/${encodeURIComponent(route.currentUsername)}`,
        });
    }

    const profile = data.profile;
    return buildRouteMetadata({
        title: buildPublicProfileTitle({
            username: profile.username,
            fullName: profile.fullName,
        }),
        description: buildProfileMetadataDescription({
            username: profile.username,
            fullName: profile.fullName,
            headline: profile.headline,
            location: profile.location,
            bio: profile.bio,
        }),
        path: `/u/${encodeURIComponent(profile.username ?? route.currentUsername)}`,
        image: profile.avatarUrl || DEFAULT_ROUTE_OG_IMAGE,
    });
}

async function ResolvedPublicProfile({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    const { username } = await params;

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

    const viewerAuth = await getViewerAuthContext();
    const data = await getProfileDetails(route.currentUsername, { viewerUser: viewerAuth.user ?? null });

    if (data.privacyStatus === 'not_found' || !data.profile) {
        notFound();
    }

    const openRolesProjects = await getProfileProjectsWithOpenRolesAction(data.profile.id);

    let viewerHasOpenRoles = false;
    if (viewerAuth?.user && viewerAuth.user.id !== data.profile.id) {
        const viewerProjects = await getProfileProjectsWithOpenRolesAction(viewerAuth.user.id);
        viewerHasOpenRoles = viewerProjects.length > 0;
    }

    return (
        <ProfileV2Client
            profile={data.profile}
            stats={data.stats}
            isOwner={data.isOwner}
            currentUser={data.currentUser}
            connectionStatus={data.connectionStatus}
            privacyRelationship={data.privacyRelationship}
            lockedShell={data.lockedShell}
            collaborationSummary={data.collaborationSummary}
            initialOpenRolesProjects={openRolesProjects}
            viewerHasOpenRoles={viewerHasOpenRoles}
        />
    );
}

export default function PublicProfilePage({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-zinc-50 dark:bg-black"
        >
            <Suspense fallback={<div className="h-full flex items-center justify-center animate-pulse text-zinc-500">Loading profile...</div>}>
                <ResolvedPublicProfile params={params} />
            </Suspense>
        </div>
    );
}
