import { RxReplicationState, replicateRxCollection } from 'rxdb/plugins/replication';
import { RxCollection } from 'rxdb';
import { createClient } from '@/lib/supabase/client';
import { ProjectDoc } from './index';

const supabase = createClient();

/**
 * Replicate a specific collection with Supabase
 */
export async function replicateSupabase(
    collection: RxCollection<any>
): Promise<RxReplicationState<any, any>> {
    const replicationState = replicateRxCollection({
        collection,
        replicationIdentifier: 'supabase-projects-sync',
        retryTime: 5000,
        pull: {
            async handler(lastCheckpoint, batchSize) {
                const minTimestamp = (lastCheckpoint as any) ? (lastCheckpoint as any).updated_at : new Date(0).toISOString();

                const { data, error } = await supabase
                    .from('projects')
                    .select('*')
                    .gt('updated_at', minTimestamp)
                    .order('updated_at', { ascending: true })
                    .limit(batchSize);

                if (error) throw error;

                // Return format expected by RxDB
                return {
                    documents: data.map((doc: any) => ({
                        id: doc.id,
                        title: doc.title,
                        description: doc.description,
                        short_description: doc.short_description || doc.shortDescription, // Handle camelCase mapping from DB if needed
                        status: doc.status,
                        visibility: doc.visibility,
                        created_at: doc.created_at,
                        updated_at: doc.updated_at,
                        owner_id: doc.owner_id || doc.ownerId,
                        json_data: {
                            tags: doc.tags,
                            skills: doc.skills,
                            cover_image: doc.cover_image
                        }, // Store extras in json_data
                        _deleted: false // Required by RxDB
                    })),
                    checkpoint: data.length > 0 ? {
                        updated_at: data[data.length - 1].updated_at
                    } : lastCheckpoint
                };
            }
        },
        push: {
            async handler(docs) {
                // Process local writes and push to Supabase
                // Note: Real-world apps need conflict resolution here.
                // For "Zero Latency" MVP, we assume local overwrites server or use upsert.

                const rows = docs.map(d => ({
                    id: d.newDocumentState.id,
                    title: d.newDocumentState.title,
                    description: d.newDocumentState.description,
                    short_description: d.newDocumentState.short_description,
                    status: d.newDocumentState.status,
                    visibility: d.newDocumentState.visibility || 'public',
                    updated_at: new Date().toISOString(), // Always update timestamp on valid push
                    owner_id: d.newDocumentState.owner_id,
                    json_data: d.newDocumentState.json_data
                }));

                // We'll use a server action or direct update. Direct update is risky for security without RLS.
                // Assuming RLS allows "Item Owner" to update own items.
                const { error } = await supabase
                    .from('projects')
                    .upsert(rows);

                if (error) throw error;

                // Return empty array to signal success for all docs
                return [];
            }
        },
        live: true
    });

    return replicationState;
}

/**
 * Replicate profiles collection
 */
export async function replicateSupabaseProfiles(
    collection: RxCollection<any>
): Promise<RxReplicationState<any, any>> {
    const replicationState = replicateRxCollection({
        collection,
        replicationIdentifier: 'supabase-profiles-sync',
        retryTime: 5000,
        pull: {
            async handler(lastCheckpoint, batchSize) {
                const minTimestamp = (lastCheckpoint as any) ? (lastCheckpoint as any).updated_at : new Date(0).toISOString();

                const { data, error } = await supabase
                    .from('profiles')
                    .select('*')
                    .gt('updated_at', minTimestamp)
                    .order('updated_at', { ascending: true })
                    .limit(batchSize);

                if (error) throw error;

                return {
                    documents: data.map((doc: any) => ({
                        id: doc.id,
                        username: doc.username,
                        full_name: doc.full_name,
                        avatar_url: doc.avatar_url,
                        headline: doc.headline,
                        bio: doc.bio,
                        location: doc.location,
                        updated_at: doc.updated_at,
                        // Store extras if any
                        json_data: {
                            website: doc.website,
                            social_links: doc.social_links
                        },
                        _deleted: false
                    })),
                    checkpoint: data.length > 0 ? {
                        updated_at: data[data.length - 1].updated_at
                    } : lastCheckpoint
                };
            }
        },
        push: {
            async handler(docs) {
                const rows = docs.map(d => ({
                    id: d.newDocumentState.id,
                    username: d.newDocumentState.username,
                    full_name: d.newDocumentState.full_name,
                    avatar_url: d.newDocumentState.avatar_url,
                    headline: d.newDocumentState.headline,
                    bio: d.newDocumentState.bio,
                    location: d.newDocumentState.location,
                    updated_at: new Date().toISOString(),
                    // Unpack json_data if needed or store as is if DB supports it.
                    // Profiles table likely has specific columns.
                    // We assume bio/location were added to schema.
                }));

                const { error } = await supabase
                    .from('profiles')
                    .upsert(rows);

                if (error) throw error;
                return [];
            }
        },
        live: true
    });

    return replicationState;
}
