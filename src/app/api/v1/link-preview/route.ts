import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '../_envelope';
import { enforceRouteLimit, requireAuthenticatedUser } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FETCH_SIZE = 512 * 1024; // 512KB max HTML to parse
const FETCH_TIMEOUT_MS = 5000;

interface LinkPreviewData {
    title: string | null;
    description: string | null;
    image: string | null;
    domain: string;
    url: string;
}

function extractMetaContent(html: string, property: string): string | null {
    // Match both property="og:X" and name="og:X" patterns
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() || null;
}

export async function GET(request: NextRequest) {
    try {
        const rlResponse = await enforceRouteLimit(request, 'api:v1:link-preview:get', 60, 60);
        if (rlResponse) return rlResponse;

        const { user, response } = await requireAuthenticatedUser();
        if (response) return response;

        const url = request.nextUrl.searchParams.get('url');
        if (!url) {
            return jsonError('Missing url parameter', 400, 'BAD_REQUEST');
        }

        // Validate URL format
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return jsonError('Invalid URL', 400, 'BAD_REQUEST');
        }

        // Only allow http/https
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return jsonError('Only HTTP/HTTPS URLs are supported', 400, 'BAD_REQUEST');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        let html: string;
        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                    'Accept': 'text/html',
                },
                redirect: 'follow',
            });

            if (!res.ok) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                });
            }

            // Only process HTML responses
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('text/html')) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                });
            }

            // Read limited amount of HTML
            const reader = res.body?.getReader();
            if (!reader) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                });
            }

            const chunks: Uint8Array[] = [];
            let totalSize = 0;
            while (totalSize < MAX_FETCH_SIZE) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                totalSize += value.length;
            }
            reader.cancel().catch(() => {});
            html = new TextDecoder().decode(Buffer.concat(chunks).slice(0, MAX_FETCH_SIZE));
        } catch {
            // Fetch failed (timeout, network error, etc.)
            return jsonSuccess<LinkPreviewData>({
                title: null,
                description: null,
                image: null,
                domain: parsedUrl.hostname,
                url,
            });
        } finally {
            clearTimeout(timeout);
        }

        // Parse OG tags
        const ogTitle = extractMetaContent(html, 'og:title');
        const ogDescription = extractMetaContent(html, 'og:description');
        const ogImage = extractMetaContent(html, 'og:image');
        const metaDescription = extractMetaContent(html, 'description');
        const title = ogTitle || extractTitle(html);
        const description = ogDescription || metaDescription;

        // Resolve relative image URL
        let image = ogImage;
        if (image && !image.startsWith('http')) {
            try {
                image = new URL(image, url).href;
            } catch {
                image = null;
            }
        }

        const preview: LinkPreviewData = {
            title: title?.slice(0, 300) || null,
            description: description?.slice(0, 500) || null,
            image: image?.slice(0, 2000) || null,
            domain: parsedUrl.hostname,
            url,
        };

        return jsonSuccess(preview, undefined, {
            headers: {
                'Cache-Control': 'public, max-age=3600, s-maxage=3600',
            },
        });
    } catch (error) {
        console.error('Link preview error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
