import { notFound } from 'next/navigation';
import { getProfileDetails, getPopularUsernames } from '@/lib/data/profile';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';
import { Metadata } from 'next';

export const revalidate = 60; // ISR: Revalidate every minute
export const dynamicParams = true; // Allow new profiles to be generated on demand

export async function generateStaticParams() {
    const usernames = await getPopularUsernames(50);
    return usernames.map((username) => ({
        username,
    }));
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
    const { username } = await params;
    const data = await getProfileDetails(username);

    if (!data?.profile) {
        return {
            title: 'Profile Not Found',
        };
    }

    return {
        title: `${data.profile.fullName || data.profile.username} (@${data.profile.username}) | Edge`,
        description: data.profile.bio || `Check out ${data.profile.username}'s profile on Edge.`,
        openGraph: {
            images: data.profile.avatarUrl ? [data.profile.avatarUrl] : [],
        },
    };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params;
    // Decode username just in case
    const decodedUsername = decodeURIComponent(username);
    const data = await getProfileDetails(decodedUsername);

    if (!data || !data.profile) {
        notFound();
    }

    // Pass data to the Client Component
    // connectionStatus, isOwner, stats etc are all calculated by getProfileDetails
    return (
        <ProfileV2Client
            profile={data.profile}
            stats={data.stats}
            isOwner={data.isOwner}
            currentUser={data.currentUser}
            connectionStatus={data.connectionStatus}
            projects={data.projects}
        />
    );
}
