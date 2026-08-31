'use client';

import { useQuery } from '@tanstack/react-query';

export interface LinkPreview {
    title: string | null;
    description: string | null;
    image: string | null;
    domain: string;
    url: string;
    titleSource?: 'provider' | 'open_graph' | 'html_title' | 'url' | null;
    health?: 'unknown' | 'active' | 'unavailable';
    checkedAt?: string;
    resolvedHost?: string;
    contentType?: string | null;
}

const URL_REGEX = /https?:\/\/[^\s]+/;

export function extractFirstUrl(content: string | null): string | null {
    if (!content) return null;
    const match = content.match(URL_REGEX);
    return match?.[0] ?? null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    const fallback = (): LinkPreview | null => {
        try {
            const domain = new URL(url).hostname;
            return {
                title: null,
                description: null,
                image: null,
                domain,
                url,
                titleSource: null,
                health: 'unknown',
                checkedAt: new Date().toISOString(),
                resolvedHost: domain,
                contentType: null,
            };
        } catch {
            return null;
        }
    };
    try {
        const res = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`);
        if (!res.ok) return fallback();
        const json = await res.json();
        if (json.success && json.data) {
            return json.data as LinkPreview;
        }
        return fallback();
    } catch {
        return fallback();
    }
}

export function useLinkPreview(url: string | null) {
    return useQuery({
        queryKey: ['link-preview', url],
        queryFn: () => fetchLinkPreview(url!),
        enabled: Boolean(url),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
