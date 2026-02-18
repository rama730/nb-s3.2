export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { cacheData, getCachedData } from '@/lib/redis';

const DEFAULT_PAGE = 0;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;

function parseNonNegativeInt(value: string | null, fallback: number) {
    if (value === null || value.trim() === '') return { ok: true as const, value: fallback };
    if (!/^\d+$/.test(value)) return { ok: false as const };
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return { ok: false as const };
    return { ok: true as const, value: parsed };
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const parsedPage = parseNonNegativeInt(searchParams.get('page'), DEFAULT_PAGE);
    const parsedLimit = parseNonNegativeInt(searchParams.get('limit'), DEFAULT_LIMIT);

    if (!parsedPage.ok || !parsedLimit.ok) {
        return NextResponse.json(
            { error: 'Invalid pagination parameters' },
            { status: 400 }
        );
    }

    const page = Math.min(parsedPage.value, MAX_PAGE);
    const limit = Math.min(Math.max(parsedLimit.value, 1), MAX_LIMIT);

    // Construct cache key based on params
    const cacheKey = `projects:public:page:${page}:limit:${limit}`;

    // 1. Try Redis Cache
    try {
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
    } catch (error) {
        console.warn('Projects cache read failed, continuing without cache', error);
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
        try {
            await cacheData(cacheKey, data, 60); // Cache for 60s
        } catch (error) {
            console.warn('Projects cache write failed, continuing without cache', error);
        }

        return NextResponse.json({
            data: data,
            source: 'database'
        });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
