'use server';

import { getHubProjects } from '@/lib/data/hub';
import { HubFilters } from '@/types/hub';

export async function fetchHubProjectsAction(
    filters: HubFilters,
    page: number = 0,
    limit: number = 24
) {
    try {
        const result = await getHubProjects(filters, page, limit);
        return { success: true, ...result };
    } catch (error) {
        console.error('Error fetching hub projects:', error);
        return {
            success: false,
            projects: [],
            hasMore: false,
            error: 'Failed to fetch projects'
        };
    }
}
