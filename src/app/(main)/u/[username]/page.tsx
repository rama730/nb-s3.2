import { notFound, permanentRedirect } from 'next/navigation';
import { getProfileDetails, getPublicProfileMeta } from '@/lib/data/profile';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';
import { Metadata } from 'next';
import { resolvePublicUsernameRoute } from '@/lib/usernames/service';

export const revalidate = 60; // ISR: Revalidate every minute
export const dynamicParams = true; // Allow new profiles to be generated on demand

export async function generateStaticParams() {
    // Intentionally disabled for scalability: we don't prebuild profiles at build time.
    // Keeping the function to satisfy Next expectations if referenced, but returning empty avoids DB load.
    return [];
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
    const { username } = await params;
    const route = await resolvePublicUsernameRoute({ username });
    if (route.status === 'not_found') {
        return {
            title: 'Profile Not Found',
        };
    }

    const data = await getPublicProfileMeta(route.currentUsername);

    if (!data) {
        return {
            title: 'Profile Not Found',
        };
    }

    return {
        title: `${data.fullName || data.username} (@${data.username}) | Edge`,
        description: data.bio || `Check out ${data.username}'s profile on Edge.`,
        openGraph: {
            images: data.avatarUrl ? [data.avatarUrl] : [],
        },
    };
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

    const route = await resolvePublicUsernameRoute({ username: decodeURIComponent(username) });
    if (route.status === 'not_found') {
        notFound();
    }
    if (route.status === 'redirect') {
        permanentRedirect(`/u/${route.currentUsername}`);
    }

    // Always render the ISR page with a visitor-safe snapshot.
    // Viewer-specific relationship state is resolved client-side after hydration.
    const data = await getProfileDetails(route.currentUsername, {
        skipHeavyData: true,
        viewerUser: null,
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
