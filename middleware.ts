import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRedisClient } from '@/lib/redis';

/**
 * Edge Middleware for Connection Status Hydration.
 *
 * PURE OPTIMIZATION: Bypasses the database to check if the current user
 * is connected to the profile they are viewing.
 *
 * This injects a special header `x-connection-status` that the server
 * component can read to avoid a DB hit for common "Connect" button state.
 */
export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Only run on profile pages: /u/[username]
    if (pathname.startsWith('/u/') && !pathname.includes('/settings')) {
        const username = pathname.split('/')[2];
        const redis = getRedisClient();
        
        // Use a lightweight cookie-based auth check for the viewer
        const viewerId = request.cookies.get('user-id')?.value;
        
        if (viewerId && username && redis) {
            try {
                // Resolution: Get target userId from username (cached in Redis)
                const targetId = await redis.get(`username:${username}:id`);
                
                if (targetId && typeof targetId === 'string') {
                    // Check connection status in O(1) Redis set
                    const isConnected = await redis.sismember(`user:${viewerId}:connections`, targetId);
                    
                    const response = NextResponse.next();
                    response.headers.set('x-connection-status', isConnected ? 'connected' : 'none');
                    return response;
                }
            } catch (err) {
                console.warn('[middleware] Redis hydration failed:', err);
            }
        }
    }

    return NextResponse.next();
}

// Ensure middleware only runs on relevant paths for performance
export const config = {
    matcher: ['/u/:path*'],
};
