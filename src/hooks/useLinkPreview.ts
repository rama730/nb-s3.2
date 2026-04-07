'use client';

import { useQuery } from '@tanstack/react-query';

export interface LinkPreview {
    title: string | null;
    description: string | null;
    image: string | null;
    domain: string;
    url: string;
}

const URL_REGEX = /https?:\/\/[^\s]+/;

export function extractFirstUrl(content: string | null): string | null {
    if (!content) return null;
    const match = content.match(URL_REGEX);
    return match?.[0] ?? null;
}

async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    try {
        const res = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
            const domain = new URL(url).hostname;
            return { title: null, description: null, image: null, domain, url };
        }
        const json = await res.json();
        if (json.success && json.data) {
            return json.data as LinkPreview;
        }
        const domain = new URL(url).hostname;
        return { title: null, description: null, image: null, domain, url };
    } catch {
        try {
            const domain = new URL(url).hostname;
            return { title: null, description: null, image: null, domain, url };
        } catch {
            return null;
        }
    }
}

export function useLinkPreview(url: string | null) {
    return useQuery({
        queryKey: ['link-preview', url],
        queryFn: () => fetchLinkPreview(url!),
        enabled: Boolean(url),
        staleTime: 5 * 60_000,
        retry: false,
    });
}
