
import { useState, useEffect } from 'react';
import { getDatabase } from '@/lib/rxdb';
import { toast } from 'sonner';

export const useLocalProfile = (userId: string) => {
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<any>(null);

    useEffect(() => {
        let sub: any = null;

        const init = async () => {
            const db = await getDatabase();
            if (!db) return;

            const query = db.profiles.findOne(userId);

            // Subscribe to changes
            sub = query.$.subscribe(doc => {
                if (doc) {
                    const rawData = doc.toJSON() as any;  // Cast to any for flexible field access
                    // Transform snake_case to camelCase for component compatibility
                    const transformedProfile = {
                        ...rawData,
                        avatarUrl: rawData.avatar_url,
                        fullName: rawData.full_name,
                        bannerUrl: rawData.banner_url,
                        socialLinks: rawData.social_links || rawData.json_data?.social_links || {},
                        availabilityStatus: rawData.availability_status || 'available',
                        openTo: rawData.open_to || rawData.json_data?.open_to || [],
                    };
                    setProfile(transformedProfile);
                    setLoading(false);
                } else {
                    // Document doesn't exist locally yet
                    setLoading(false);
                }
            });
        };

        init();

        return () => {
            if (sub) sub.unsubscribe();
        };
    }, [userId]);

    // Function to update profile optimistically
    const updateProfile = async (updates: Partial<any>) => {
        try {
            const db = await getDatabase();
            if (!db) return;

            // 1. Optimistic Update in RxDB
            // RxDB upsert will trigger the document update
            const doc = await db.profiles.findOne(userId).exec();

            // Split updates into schema fields and json_data to avoid schema errors
            const schemaFields = ['id', 'username', 'full_name', 'avatar_url', 'headline', 'bio', 'location', 'website', 'banner_url', 'updated_at'];
            const topLevelUpdates: any = {};
            const jsonDataUpdates: any = doc ? (doc.toJSON() as any).json_data || {} : {};

            Object.entries(updates).forEach(([key, value]) => {
                if (schemaFields.includes(key)) {
                    topLevelUpdates[key] = value;
                } else {
                    jsonDataUpdates[key] = value;
                }
            });

            if (doc) {
                await doc.update({
                    $set: {
                        ...topLevelUpdates,
                        json_data: jsonDataUpdates,
                        updated_at: new Date().toISOString()
                    }
                });
            } else {
                // Should exist if we are updating, but safe insert
                await db.profiles.upsert({
                    id: userId,
                    ...topLevelUpdates,
                    json_data: jsonDataUpdates,
                    updated_at: new Date().toISOString()
                });
            }

            toast.success('Profile updated');
        } catch (error) {
            console.error('Update failed', error);
            toast.error('Failed to update profile');
        }
    };

    return {
        profile: profile || null,
        loading: loading && !profile,
        updateProfile
    };
};
