export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getHubProjects } from '@/lib/data/hub'; // We'll need to make sure this is Edge compatible or refactor
import { redis, cacheData, getCachedData } from '@/lib/redis';
import { HubFilters } from '@/types/hub';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '0');
    const limit = parseInt(searchParams.get('limit') || '24');

    // Construct cache key based on params
    const cacheKey = `projects:public:page:${page}:limit:${limit}:q:${searchParams.get('q') || ''}:sort:${searchParams.get('sort') || ''}`;

    // 1. Try Redis Cache
    const cached = await getCachedData(cacheKey);
    if (cached) {
        return NextResponse.json({
            data: cached,
            source: 'redis-edge-cache'
        }, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
                'X-Edge-Region': 'global'
            }
        });
    }

    // 2. Fetch from DB if miss
    // Note: getHubProjects uses Drizzle which might need 'neon-serverless' for Edge 
    // OR we just use standard fetch to Supabase REST API for true Edge compatibility if Drizzle isn't Edge-ready yet.
    // However, Drizzle with Supabase/Postgres.js usually requires Node environment.
    // FOR USER: We will assume standard fetching for now, but to be TRUE Edge, we might need 
    // to use Supabase REST Client or Neon Drizzle driver. 
    // Given the constraints, let's implement a direct Supabase REST call for maximum Edge speed + compatibility.

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // Simple REST fetch to avoid Node-dependency issues in Edge
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/projects?select=*,profiles:owner_id(id,username,full_name,avatar_url)&visibility=eq.public&order=created_at.desc&limit=${limit}&offset=${page * limit}`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });

        if (!response.ok) throw new Error('Supabase fetch failed');

        const data = await response.json();

        // 3. Cache Result
        await cacheData(cacheKey, data, 60); // Cache for 60s

        return NextResponse.json({
            data: data,
            source: 'database'
        });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
