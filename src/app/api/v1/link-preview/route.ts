import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/app/api/v1/_envelope';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import {
    fetchPublicUrlWithRedirectValidation,
    UnsafeOutboundUrlError,
} from '@/lib/security/outbound-url';
import { isSafeHttpUrl } from '@/lib/security/urls';
import { logger } from '@/lib/logger';
import { normalizeLinkDestinationTitle } from '@/lib/links/destination-title';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FETCH_SIZE = 512 * 1024; // 512KB max HTML to download
// SEC-H11: regex parsing only ever sees the first 64KB of the document. OG
// metadata is supposed to live in <head>, which is virtually always smaller
// than this. A malicious origin that pads <head> beyond this limit is treated
// as having no preview metadata. This bounds the worst-case work each regex
// has to do, so even if our patterns are technically polynomial in input
// length, the constant factor stays tiny.
const MAX_REGEX_INPUT_BYTES = 64 * 1024;
// Cap on the captured value of any single OG/meta tag before further trimming.
// Defends against a 1MB <meta content="..."> blob being matched and held in
// memory before the post-extraction `.slice` runs.
const MAX_META_CONTENT_LENGTH = 8 * 1024;
const FETCH_TIMEOUT_MS = 5000;

interface LinkPreviewData {
    title: string | null;
    description: string | null;
    image: string | null;
    domain: string;
    url: string;
    titleSource: 'provider' | 'open_graph' | 'html_title' | 'url' | null;
    health: 'unknown' | 'active' | 'unavailable';
    checkedAt: string;
    resolvedHost: string;
    contentType: string | null;
}

const PRIVATE_PREVIEW_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' };

function previewHealth(status: number): LinkPreviewData['health'] {
    if (status === 404 || status === 410) return 'unavailable';
    return status >= 200 && status < 500 ? 'active' : 'unknown';
}

function clampForRegex(html: string): string {
    return html.length > MAX_REGEX_INPUT_BYTES ? html.slice(0, MAX_REGEX_INPUT_BYTES) : html;
}

function extractMetaContent(html: string, property: string): string | null {
    // SEC-H11: bounded-length character classes and an anchored literal between
    // the two `[^>]` runs keep matching linear under all inputs. A second
    // {0,N} cap is added to make the linearity explicit even if a future
    // engine-level change loosened semantics.
    const patterns = [
        new RegExp(
            `<meta[^>]{0,256}(?:property|name)=["']${property}["'][^>]{0,256}content=["']([^"']{0,${MAX_META_CONTENT_LENGTH}})["']`,
            'i',
        ),
        new RegExp(
            `<meta[^>]{0,256}content=["']([^"']{0,${MAX_META_CONTENT_LENGTH}})["'][^>]{0,256}(?:property|name)=["']${property}["']`,
            'i',
        ),
    ];
    const haystack = clampForRegex(html);
    for (const pattern of patterns) {
        const match = haystack.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function extractTitle(html: string): string | null {
    const match = clampForRegex(html).match(/<title[^>]{0,256}>([^<]{0,1024})<\/title>/i);
    return match?.[1]?.trim() || null;
}

function isYouTubeUrl(url: URL) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

function isGoogleScholarUrl(url: URL) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'scholar.google.com' || host.endsWith('.scholar.google.com');
}

async function fetchYouTubeOEmbed(url: string): Promise<LinkPreviewData | null> {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('url', url);

    try {
        const { response } = await fetchPublicUrlWithRedirectValidation({
            url: endpoint,
            timeoutMs: FETCH_TIMEOUT_MS,
            maxRedirects: 2,
            init: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                    'Accept': 'application/json',
                },
            },
        });
        if (!response.ok) return null;
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_META_CONTENT_LENGTH * 4) return null;
        const body = await response.text();
        if (body.length > MAX_META_CONTENT_LENGTH * 4) return null;
        const payload = JSON.parse(body) as Record<string, unknown>;
        const title = normalizeLinkDestinationTitle(payload.title, 'youtube');
        if (!title) return null;
        const thumbnail = typeof payload.thumbnail_url === 'string' && isSafeHttpUrl(payload.thumbnail_url)
            ? payload.thumbnail_url.slice(0, 2000)
            : null;
        return {
            title,
            description: normalizeLinkDestinationTitle(payload.author_name)?.slice(0, 500) || null,
            image: thumbnail,
            domain: new URL(url).hostname,
            url,
            titleSource: 'provider',
            health: 'active',
            checkedAt: new Date().toISOString(),
            resolvedHost: new URL(url).hostname,
            contentType: 'application/json',
        };
    } catch {
        return null;
    }
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

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return jsonError('Invalid URL', 400, 'BAD_REQUEST');
        }

        // YouTube watch URLs contain only the route name (`watch`) locally.
        // oEmbed is the provider-supported, keyless source for the exact video
        // title and is both more stable and cheaper than parsing the full page.
        if (isYouTubeUrl(parsedUrl)) {
            const youtubePreview = await fetchYouTubeOEmbed(url);
            if (youtubePreview) {
                return jsonSuccess(youtubePreview, undefined, {
                    headers: PRIVATE_PREVIEW_CACHE_HEADERS,
                });
            }
        }

        let html: string;
        try {
            const { response: res, resolvedUrl } = await fetchPublicUrlWithRedirectValidation({
                url,
                timeoutMs: FETCH_TIMEOUT_MS,
                maxRedirects: 3,
                init: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                        'Accept': 'text/html',
                    },
                },
            });
            parsedUrl = resolvedUrl;

            if (!res.ok) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                    titleSource: null,
                    health: previewHealth(res.status),
                    checkedAt: new Date().toISOString(),
                    resolvedHost: parsedUrl.hostname,
                    contentType: res.headers.get('content-type'),
                }, undefined, { headers: PRIVATE_PREVIEW_CACHE_HEADERS });
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
                    titleSource: null,
                    health: 'active',
                    checkedAt: new Date().toISOString(),
                    resolvedHost: parsedUrl.hostname,
                    contentType,
                }, undefined, { headers: PRIVATE_PREVIEW_CACHE_HEADERS });
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
                    titleSource: null,
                    health: 'active',
                    checkedAt: new Date().toISOString(),
                    resolvedHost: parsedUrl.hostname,
                    contentType,
                }, undefined, { headers: PRIVATE_PREVIEW_CACHE_HEADERS });
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
        } catch (error) {
            if (error instanceof UnsafeOutboundUrlError) {
                logger.warn('link-preview.outbound_url_blocked', {
                    module: 'api',
                    userId: user?.id ?? undefined,
                    requestedHost: parsedUrl.hostname,
                    error: error.message,
                });
                return jsonError('URL is not allowed', 400, 'BAD_REQUEST');
            }
            // Fetch failed (timeout, network error, etc.)
            return jsonSuccess<LinkPreviewData>({
                title: null,
                description: null,
                image: null,
                domain: parsedUrl.hostname,
                url,
                titleSource: null,
                health: 'unknown',
                checkedAt: new Date().toISOString(),
                resolvedHost: parsedUrl.hostname,
                contentType: null,
            }, undefined, { headers: PRIVATE_PREVIEW_CACHE_HEADERS });
        }

        // Parse OG tags
        const ogTitle = extractMetaContent(html, 'og:title');
        const ogDescription = extractMetaContent(html, 'og:description');
        const ogImage = extractMetaContent(html, 'og:image');
        const metaDescription = extractMetaContent(html, 'description');
        const platform = isYouTubeUrl(parsedUrl)
            ? 'youtube'
            : isGoogleScholarUrl(parsedUrl)
                ? 'google-scholar'
                : null;
        const htmlTitle = extractTitle(html);
        const title = normalizeLinkDestinationTitle(ogTitle || htmlTitle, platform);
        const description = ogDescription || metaDescription;

        // Resolve relative image URL and re-validate it. SEC-C6: a malicious
        // site can advertise og:image="javascript:..." or a private-host URL,
        // and any consumer that renders <img src={preview.image}> becomes an
        // XSS / SSRF sink. We accept only absolute http(s) URLs that pass the
        // shared safe-URL gate.
        let image: string | null = ogImage;
        if (image) {
            try {
                const resolved = new URL(image, parsedUrl).href;
                image = isSafeHttpUrl(resolved) ? resolved : null;
            } catch {
                image = null;
            }
        }

        const preview: LinkPreviewData = {
            title,
            description: description?.slice(0, 500) || null,
            image: image ? image.slice(0, 2000) : null,
            domain: parsedUrl.hostname,
            url,
            titleSource: title ? (ogTitle ? 'open_graph' : 'html_title') : 'url',
            health: 'active',
            checkedAt: new Date().toISOString(),
            resolvedHost: parsedUrl.hostname,
            contentType: 'text/html',
        };

        return jsonSuccess(preview, undefined, {
            headers: {
                ...PRIVATE_PREVIEW_CACHE_HEADERS,
            },
        });
    } catch (error) {
        console.error('Link preview error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
