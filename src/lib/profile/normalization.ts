/**
 * C6: Single source of truth for profile normalization.
 * Handles camelCase (Drizzle) ↔ snake_case (Supabase REST) conversions,
 * form state, server payload, and optimistic update transformations.
 */

import { isSafeHttpUrl } from '@/lib/security/urls';
import { findDomainPresence, type DomainPresenceIconKey } from '@/lib/profile/domain-presence';

export const SOCIAL_LINK_PLATFORMS = [
    'github', 'x', 'twitter', 'linkedin', 'website', 'portfolio', 'dribbble',
    'instagram', 'bluesky', 'mastodon', 'youtube', 'twitch', 'threads',
    'facebook', 'discord', 'figma', 'slack', 'notion',
    'google-scholar', 'researchgate', 'orcid', 'arxiv', 'doi',
    'semantic-scholar', 'academia', 'pubmed', 'zenodo', 'mendeley',
    'gitlab', 'bitbucket', 'stackoverflow', 'codepen', 'behance',
    'medium', 'substack', 'reddit', 'tiktok',
    'framer', 'webflow', 'canva', 'sketch', 'zeplin', 'invision', 'miro',
    'proto-io', 'uxpin', 'adobe-portfolio', 'pinterest', 'awwwards',
    'loom', 'penpot', 'rive', 'maze', 'mobbin', 'uxfolio', 'readymag',
    'cargo', 'carbonmade', 'coroflot', 'contra', 'spline', 'balsamiq',
    'other',
] as const;
export type SocialLinkPlatform = (typeof SOCIAL_LINK_PLATFORMS)[number];
const SOCIAL_LINK_PLATFORM_SET = new Set<string>(SOCIAL_LINK_PLATFORMS);

export type SocialPresenceIconKey =
    | 'github'
    | 'x'
    | 'linkedin'
    | 'instagram'
    | 'youtube'
    | 'twitch'
    | 'facebook'
    | 'discord'
    | 'figma'
    | 'slack'
    | 'notion'
    | 'google-scholar'
    | 'researchgate'
    | 'orcid'
    | 'arxiv'
    | 'doi'
    | 'semantic-scholar'
    | 'academia'
    | 'pubmed'
    | 'zenodo'
    | 'mendeley'
    | 'gitlab'
    | 'bitbucket'
    | 'stackoverflow'
    | 'codepen'
    | 'dribbble'
    | 'bluesky'
    | 'mastodon'
    | 'threads'
    | 'behance'
    | 'medium'
    | 'substack'
    | 'reddit'
    | 'tiktok'
    | 'framer'
    | 'webflow'
    | 'canva'
    | 'sketch'
    | 'zeplin'
    | 'invision'
    | 'miro'
    | 'proto-io'
    | 'uxpin'
    | 'adobe-portfolio'
    | 'pinterest'
    | 'awwwards'
    | 'loom'
    | 'penpot'
    | 'rive'
    | 'maze'
    | 'mobbin'
    | 'uxfolio'
    | 'readymag'
    | 'cargo'
    | 'carbonmade'
    | 'coroflot'
    | 'contra'
    | 'spline'
    | 'balsamiq'
    | DomainPresenceIconKey
    | 'globe';

type SocialPresenceDefinition = {
    label: string;
    iconKey: SocialPresenceIconKey | null;
    domains?: readonly string[];
};

/** Labels used by the editor. The resolver still detects the canonical service from the URL. */
export const SOCIAL_LINK_PLATFORM_OPTIONS: ReadonlyArray<{ value: SocialLinkPlatform; label: string }> = [
    { value: 'github', label: 'GitHub' },
    { value: 'x', label: 'X (Twitter)' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'website', label: 'Website' },
    { value: 'portfolio', label: 'Portfolio' },
    { value: 'dribbble', label: 'Dribbble' },
    { value: 'bluesky', label: 'Bluesky' },
    { value: 'mastodon', label: 'Mastodon' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'twitch', label: 'Twitch' },
    { value: 'threads', label: 'Threads' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'discord', label: 'Discord' },
    { value: 'figma', label: 'Figma' },
    { value: 'slack', label: 'Slack' },
    { value: 'notion', label: 'Notion' },
    { value: 'google-scholar', label: 'Google Scholar' },
    { value: 'researchgate', label: 'ResearchGate' },
    { value: 'orcid', label: 'ORCID' },
    { value: 'arxiv', label: 'arXiv' },
    { value: 'doi', label: 'DOI' },
    { value: 'semantic-scholar', label: 'Semantic Scholar' },
    { value: 'academia', label: 'Academia.edu' },
    { value: 'pubmed', label: 'PubMed' },
    { value: 'zenodo', label: 'Zenodo' },
    { value: 'mendeley', label: 'Mendeley' },
    { value: 'gitlab', label: 'GitLab' },
    { value: 'bitbucket', label: 'Bitbucket' },
    { value: 'stackoverflow', label: 'Stack Overflow' },
    { value: 'codepen', label: 'CodePen' },
    { value: 'behance', label: 'Behance' },
    { value: 'medium', label: 'Medium' },
    { value: 'substack', label: 'Substack' },
    { value: 'reddit', label: 'Reddit' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'framer', label: 'Framer' },
    { value: 'webflow', label: 'Webflow' },
    { value: 'canva', label: 'Canva' },
    { value: 'sketch', label: 'Sketch' },
    { value: 'zeplin', label: 'Zeplin' },
    { value: 'invision', label: 'InVision' },
    { value: 'miro', label: 'Miro' },
    { value: 'proto-io', label: 'Proto.io' },
    { value: 'uxpin', label: 'UXPin' },
    { value: 'adobe-portfolio', label: 'Adobe Portfolio' },
    { value: 'pinterest', label: 'Pinterest' },
    { value: 'awwwards', label: 'Awwwards' },
    { value: 'loom', label: 'Loom' },
    { value: 'penpot', label: 'Penpot' },
    { value: 'rive', label: 'Rive' },
    { value: 'maze', label: 'Maze' },
    { value: 'mobbin', label: 'Mobbin' },
    { value: 'uxfolio', label: 'UXfolio' },
    { value: 'readymag', label: 'Readymag' },
    { value: 'cargo', label: 'Cargo' },
    { value: 'carbonmade', label: 'Carbonmade' },
    { value: 'coroflot', label: 'Coroflot' },
    { value: 'contra', label: 'Contra' },
    { value: 'spline', label: 'Spline' },
    { value: 'balsamiq', label: 'Balsamiq' },
    { value: 'other', label: 'Other' },
];

/**
 * The one service registry used by profile editing, project editing, display,
 * and the safe-open route.  A service is recognised from its URL; a picker is
 * deliberately not required and cannot override this registry.
 */
export const SOCIAL_PRESENCE: Record<SocialLinkPlatform, SocialPresenceDefinition> = {
    github: { label: 'GitHub', iconKey: 'github', domains: ['github.com'] },
    x: { label: 'X (Twitter)', iconKey: 'x', domains: ['x.com', 'twitter.com'] },
    twitter: { label: 'X (Twitter)', iconKey: 'x', domains: ['x.com', 'twitter.com'] },
    linkedin: { label: 'LinkedIn', iconKey: 'linkedin', domains: ['linkedin.com'] },
    website: { label: 'Website', iconKey: 'globe' },
    portfolio: { label: 'Portfolio', iconKey: 'globe' },
    dribbble: { label: 'Dribbble', iconKey: 'dribbble', domains: ['dribbble.com'] },
    instagram: { label: 'Instagram', iconKey: 'instagram', domains: ['instagram.com'] },
    bluesky: { label: 'Bluesky', iconKey: 'bluesky', domains: ['bsky.app'] },
    mastodon: { label: 'Mastodon', iconKey: 'mastodon', domains: ['mastodon.social', 'mastodon.online', 'mstdn.social'] },
    youtube: { label: 'YouTube', iconKey: 'youtube', domains: ['youtube.com', 'youtu.be'] },
    twitch: { label: 'Twitch', iconKey: 'twitch', domains: ['twitch.tv'] },
    threads: { label: 'Threads', iconKey: 'threads', domains: ['threads.net'] },
    facebook: { label: 'Facebook', iconKey: 'facebook', domains: ['facebook.com', 'fb.com'] },
    discord: { label: 'Discord', iconKey: 'discord', domains: ['discord.com', 'discord.gg'] },
    figma: { label: 'Figma', iconKey: 'figma', domains: ['figma.com'] },
    slack: { label: 'Slack', iconKey: 'slack', domains: ['slack.com'] },
    notion: { label: 'Notion', iconKey: 'notion', domains: ['notion.so', 'notion.site'] },
    'google-scholar': { label: 'Google Scholar', iconKey: 'google-scholar', domains: ['scholar.google.com'] },
    researchgate: { label: 'ResearchGate', iconKey: 'researchgate', domains: ['researchgate.net'] },
    orcid: { label: 'ORCID', iconKey: 'orcid', domains: ['orcid.org'] },
    arxiv: { label: 'arXiv', iconKey: 'arxiv', domains: ['arxiv.org'] },
    doi: { label: 'DOI', iconKey: 'doi', domains: ['doi.org'] },
    'semantic-scholar': { label: 'Semantic Scholar', iconKey: 'semantic-scholar', domains: ['semanticscholar.org'] },
    academia: { label: 'Academia.edu', iconKey: 'academia', domains: ['academia.edu'] },
    pubmed: { label: 'PubMed', iconKey: 'pubmed', domains: ['pubmed.ncbi.nlm.nih.gov'] },
    zenodo: { label: 'Zenodo', iconKey: 'zenodo', domains: ['zenodo.org'] },
    mendeley: { label: 'Mendeley', iconKey: 'mendeley', domains: ['mendeley.com'] },
    gitlab: { label: 'GitLab', iconKey: 'gitlab', domains: ['gitlab.com'] },
    bitbucket: { label: 'Bitbucket', iconKey: 'bitbucket', domains: ['bitbucket.org'] },
    stackoverflow: { label: 'Stack Overflow', iconKey: 'stackoverflow', domains: ['stackoverflow.com'] },
    codepen: { label: 'CodePen', iconKey: 'codepen', domains: ['codepen.io'] },
    behance: { label: 'Behance', iconKey: 'behance', domains: ['behance.net'] },
    medium: { label: 'Medium', iconKey: 'medium', domains: ['medium.com'] },
    substack: { label: 'Substack', iconKey: 'substack', domains: ['substack.com'] },
    reddit: { label: 'Reddit', iconKey: 'reddit', domains: ['reddit.com', 'redd.it'] },
    tiktok: { label: 'TikTok', iconKey: 'tiktok', domains: ['tiktok.com'] },
    framer: { label: 'Framer', iconKey: 'framer', domains: ['framer.com'] },
    webflow: { label: 'Webflow', iconKey: 'webflow', domains: ['webflow.com', 'webflow.io'] },
    canva: { label: 'Canva', iconKey: 'canva', domains: ['canva.com'] },
    sketch: { label: 'Sketch', iconKey: 'sketch', domains: ['sketch.com'] },
    zeplin: { label: 'Zeplin', iconKey: 'zeplin', domains: ['zeplin.io'] },
    invision: { label: 'InVision', iconKey: 'invision', domains: ['invisionapp.com', 'invision.com'] },
    miro: { label: 'Miro', iconKey: 'miro', domains: ['miro.com'] },
    'proto-io': { label: 'Proto.io', iconKey: 'proto-io', domains: ['proto.io', 'pr.to'] },
    uxpin: { label: 'UXPin', iconKey: 'uxpin', domains: ['uxpin.com'] },
    'adobe-portfolio': { label: 'Adobe Portfolio', iconKey: 'adobe-portfolio', domains: ['myportfolio.com', 'portfolio.adobe.com', 'xd.adobe.com'] },
    pinterest: { label: 'Pinterest', iconKey: 'pinterest', domains: ['pinterest.com', 'pin.it'] },
    awwwards: { label: 'Awwwards', iconKey: 'awwwards', domains: ['awwwards.com'] },
    loom: { label: 'Loom', iconKey: 'loom', domains: ['loom.com'] },
    penpot: { label: 'Penpot', iconKey: 'penpot', domains: ['penpot.app'] },
    rive: { label: 'Rive', iconKey: 'rive', domains: ['rive.app'] },
    maze: { label: 'Maze', iconKey: 'maze', domains: ['maze.co'] },
    mobbin: { label: 'Mobbin', iconKey: 'mobbin', domains: ['mobbin.com'] },
    uxfolio: { label: 'UXfolio', iconKey: 'uxfolio', domains: ['uxfol.io', 'uxfolio.com'] },
    readymag: { label: 'Readymag', iconKey: 'readymag', domains: ['readymag.com'] },
    cargo: { label: 'Cargo', iconKey: 'cargo', domains: ['cargo.site', 'cargocollective.com'] },
    carbonmade: { label: 'Carbonmade', iconKey: 'carbonmade', domains: ['carbonmade.com'] },
    coroflot: { label: 'Coroflot', iconKey: 'coroflot', domains: ['coroflot.com'] },
    contra: { label: 'Contra', iconKey: 'contra', domains: ['contra.com'] },
    spline: { label: 'Spline', iconKey: 'spline', domains: ['spline.design'] },
    balsamiq: { label: 'Balsamiq', iconKey: 'balsamiq', domains: ['balsamiq.com', 'balsamiq.cloud'] },
    other: { label: 'Link', iconKey: null },
};

/**
 * V2 storage supports several links for the same service (especially custom
 * sites), an intentional display order, and an optional label for unknown
 * domains.  Older object-shaped rows remain readable forever and are upgraded
 * the first time the owner saves them.
 */
export type SocialLinkItem = {
    id: string;
    url: string;
    /** A hint only. The URL resolver is authoritative for recognised services. */
    platform?: string;
    /** Available only for an unrecognised/custom website. */
    label?: string;
    /** Resolved or owner-confirmed name of the exact profile/resource. */
    destinationLabel?: string;
    /** What this destination contributes to a project, independent of vendor. */
    purpose?: ProjectLinkPurpose;
    /** Project members can keep operational destinations out of public surfaces. */
    audience?: ProjectLinkAudience;
    /** Draft-only enrichment. Project write paths split this into derived metadata. */
    metadata?: ProjectLinkMetadata;
    order?: number;
};

export const PROJECT_LINK_PURPOSES = [
    'live-product',
    'source-code',
    'documentation',
    'design-prototype',
    'research-publication',
    'dataset-model',
    'demo-media',
    'community',
    'distribution-store',
    'roadmap-operations',
    'support-contact',
    'commerce-funding',
    'other',
] as const;

export type ProjectLinkPurpose = typeof PROJECT_LINK_PURPOSES[number];
export type ProjectLinkAudience = 'public' | 'members';
export type ProjectLinkNameSource = 'provider' | 'open_graph' | 'html_title' | 'url' | 'manual';
export type ProjectLinkHealth = 'unknown' | 'active' | 'unavailable';

export type ProjectLinkMetadata = {
    health: ProjectLinkHealth;
    checkedAt?: string;
    nameSource?: ProjectLinkNameSource;
    fetchedAt?: string;
    resolvedHost?: string;
    contentType?: string;
};

export type ProjectLinkMetadataRecord = Record<string, ProjectLinkMetadata>;

export type SocialLinkStorage = Record<string, string> | SocialLinkItem[];

/** A renamed/deleted public handle is the only failure we retain for recovery. */
export function isStaleSocialLinkStatus(status: number): boolean {
    return status === 404 || status === 410;
}

const SOCIAL_LINK_LIMIT = 20;
const SOCIAL_LINK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function deterministicLinkId(value: string, index: number, used: Set<string>): string {
    let hash = 5381;
    const source = `${value}:${index}`;
    for (let cursor = 0; cursor < source.length; cursor += 1) hash = ((hash * 33) ^ source.charCodeAt(cursor)) >>> 0;
    const stem = `link-${hash.toString(36)}`;
    let id = stem;
    let suffix = 2;
    while (used.has(id)) id = `${stem}-${suffix++}`;
    used.add(id);
    return id;
}

/** Converts legacy records and V2 arrays into stable, ordered items. */
export function socialLinkItemsFromStorage(value: unknown): SocialLinkItem[] {
    const rawItems: Array<Partial<SocialLinkItem> & { platform?: string }> = [];
    if (Array.isArray(value)) {
        for (const candidate of value) {
            if (!candidate || typeof candidate !== 'object') continue;
            const item = candidate as Record<string, unknown>;
            rawItems.push({
                id: typeof item.id === 'string' ? item.id : undefined,
                url: typeof item.url === 'string' ? item.url : '',
                platform: typeof item.platform === 'string' ? item.platform : undefined,
                label: typeof item.label === 'string' ? item.label : undefined,
                destinationLabel: typeof item.destinationLabel === 'string' ? item.destinationLabel : undefined,
                purpose: PROJECT_LINK_PURPOSES.includes(item.purpose as ProjectLinkPurpose) ? item.purpose as ProjectLinkPurpose : undefined,
                audience: item.audience === 'members' ? 'members' : item.audience === 'public' ? 'public' : undefined,
                metadata: sanitizeProjectLinkMetadata(item.metadata),
                order: typeof item.order === 'number' ? item.order : undefined,
            });
        }
    } else if (value && typeof value === 'object') {
        for (const [platform, url] of Object.entries(value as Record<string, unknown>)) {
            if (platform === '__proto__' || platform === 'constructor' || platform === 'prototype') continue;
            if (typeof url === 'string') rawItems.push({ platform, url });
        }
    }

    const used = new Set<string>();
    return rawItems.slice(0, SOCIAL_LINK_LIMIT).map((item, index) => ({
        id: item.id && SOCIAL_LINK_ID_RE.test(item.id) && !used.has(item.id)
            ? (used.add(item.id), item.id)
            : deterministicLinkId(`${item.platform || ''}:${item.url || ''}`, index, used),
        url: item.url || '',
        ...(item.platform ? { platform: item.platform } : {}),
        ...(item.label ? { label: item.label } : {}),
        ...(item.destinationLabel ? { destinationLabel: item.destinationLabel } : {}),
        ...(item.purpose ? { purpose: item.purpose } : {}),
        ...(item.audience ? { audience: item.audience } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
        order: Number.isFinite(item.order) ? Number(item.order) : index,
    })).sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

/**
 * Validates any supported stored representation and always returns V2 items.
 * The caller persists the returned array, giving existing accounts a gradual,
 * migration-on-save upgrade without a blocking database migration.
 */
export function validateSocialLinkCollection(links: unknown):
    | { success: true; links: SocialLinkItem[] }
    | { success: false; error: string } {
    if (links === null || links === undefined) return { success: true, links: [] };
    if (typeof links !== 'object') return { success: false, error: 'Links must be a list of public web addresses.' };
    if ((Array.isArray(links) ? links.length : Object.keys(links).length) > SOCIAL_LINK_LIMIT) {
        return { success: false, error: `Add no more than ${SOCIAL_LINK_LIMIT} links.` };
    }

    const normalized: SocialLinkItem[] = [];
    const seenUrls = new Set<string>();
    for (const item of socialLinkItemsFromStorage(links)) {
        const url = normalizeOptionalProfileUrl(item.url);
        if (!url) return { success: false, error: 'This link cannot be used because its destination is not safe.' };
        const resolved = resolveSocialPresence(item.platform, url);
        if (!resolved) return { success: false, error: 'This link cannot be used because its destination is not safe.' };
        if (seenUrls.has(resolved.url)) continue;
        seenUrls.add(resolved.url);
        const requestedLabel = typeof item.label === 'string' ? item.label.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
        const destinationLabel = typeof item.destinationLabel === 'string'
            ? item.destinationLabel.trim().replace(/\s+/g, ' ').slice(0, 160)
            : '';
        const isGeneric = ['website', 'portfolio', 'other'].includes(resolved.platform);
        normalized.push({
            id: item.id,
            url: resolved.url,
            platform: resolved.platform,
            ...(isGeneric && requestedLabel ? { label: requestedLabel } : {}),
            ...(destinationLabel ? { destinationLabel } : {}),
            ...(item.purpose && PROJECT_LINK_PURPOSES.includes(item.purpose) ? { purpose: item.purpose } : {}),
            audience: item.audience === 'members' ? 'members' : 'public',
            ...(item.metadata ? { metadata: sanitizeProjectLinkMetadata(item.metadata) } : {}),
            order: normalized.length,
        });
    }
    return { success: true, links: normalized };
}

function safeMetadataTimestamp(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function sanitizeProjectLinkMetadata(value: unknown): ProjectLinkMetadata | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const health: ProjectLinkHealth = input.health === 'active' || input.health === 'unavailable' ? input.health : 'unknown';
    const nameSource = ['provider', 'open_graph', 'html_title', 'url', 'manual'].includes(String(input.nameSource || ''))
        ? input.nameSource as ProjectLinkNameSource
        : undefined;
    const resolvedHost = typeof input.resolvedHost === 'string'
        ? input.resolvedHost.trim().toLowerCase().slice(0, 253)
        : undefined;
    const contentType = typeof input.contentType === 'string'
        ? input.contentType.trim().toLowerCase().slice(0, 120)
        : undefined;
    return {
        health,
        ...(safeMetadataTimestamp(input.checkedAt) ? { checkedAt: safeMetadataTimestamp(input.checkedAt) } : {}),
        ...(nameSource ? { nameSource } : {}),
        ...(safeMetadataTimestamp(input.fetchedAt) ? { fetchedAt: safeMetadataTimestamp(input.fetchedAt) } : {}),
        ...(resolvedHost ? { resolvedHost } : {}),
        ...(contentType ? { contentType } : {}),
    };
}

/** Warns without rewriting: signed URLs may be intentional, but should not be published accidentally. */
export function findSensitiveLinkParameters(rawUrl: string): string[] {
    try {
        const parsed = new URL(rawUrl);
        const sensitive = /^(?:access_?token|auth|authorization|api_?key|key|password|secret|signature|sig|token)$/i;
        return [...new Set([...parsed.searchParams.keys()].filter((key) => sensitive.test(key)))];
    } catch {
        return [];
    }
}

/**
 * Rebase an in-progress social-link edit on the latest saved collection.
 * Unchanged local items adopt the server version; local edits win only for
 * that item; separately-added links from both sessions are retained.  This is
 * intentionally limited to links so concurrent changes to identity/privacy
 * fields still require an explicit refresh rather than a surprising merge.
 */
export function mergeSocialLinkCollections(base: unknown, local: unknown, remote: unknown): SocialLinkItem[] {
    const baseItems = socialLinkItemsFromStorage(base);
    const localItems = socialLinkItemsFromStorage(local);
    const remoteItems = socialLinkItemsFromStorage(remote);
    const baseById = new Map(baseItems.map((item) => [item.id, item]));
    const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
    const merged: SocialLinkItem[] = [];
    const localIds = new Set(localItems.map((item) => item.id));

    for (const localItem of localItems) {
        const baseline = baseById.get(localItem.id);
        const serverItem = remoteById.get(localItem.id);
        const unchangedLocally = baseline && JSON.stringify({ ...baseline, order: 0 }) === JSON.stringify({ ...localItem, order: 0 });
        if (unchangedLocally && serverItem) merged.push(serverItem);
        else merged.push(localItem);
    }
    for (const remoteItem of remoteItems) {
        // Preserve intentional local deletions; only merge records added by a
        // separate session after this editor opened.
        if (!localIds.has(remoteItem.id) && !baseById.has(remoteItem.id)) merged.push(remoteItem);
    }
    const baseOrder = baseItems.map((item) => item.id).join('|');
    const localOrder = localItems.map((item) => item.id).filter((id) => baseById.has(id)).join('|');
    const reorderedLocally = baseOrder !== localOrder && localOrder.length > 0;
    const orderedMerged = reorderedLocally
        ? [...localItems.map((item) => merged.find((candidate) => candidate.id === item.id)).filter((item): item is SocialLinkItem => Boolean(item)), ...merged.filter((item) => !localIds.has(item.id))]
        : merged;
    const validated = validateSocialLinkCollection(orderedMerged.map((item, order) => ({ ...item, order })));
    return validated.success ? validated.links : localItems;
}

export function normalizeOptionalProfileUrl(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return '';
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return isSafeHttpUrl(candidate) ? candidate : '';
}

export function normalizeSocialLinkRecord(links: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!links) return undefined;
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(links)) {
        const platform = key.trim().toLowerCase().slice(0, 32);
        if (!SOCIAL_LINK_PLATFORM_SET.has(platform)) continue;
        const url = normalizeOptionalProfileUrl(String(raw || ''));
        if (url) out[platform] = url;
    }
    return out;
}

/**
 * The write-path companion to `normalizeSocialLinkRecord`.
 * Empty fields are removals; a non-empty unsafe or unsupported value blocks
 * the link update instead of silently dropping a value the user entered.
 */
export function validateSocialLinkRecord(links: unknown):
    | { success: true; links: Record<string, string> }
    | { success: false; error: string } {
    if (links === null || links === undefined) return { success: true, links: {} };
    if (typeof links !== 'object' || Array.isArray(links)) {
        return { success: false, error: 'Links must be a list of public web addresses.' };
    }

    const normalized: Record<string, string> = {};
    const seen = new Set<string>();
    for (const [rawPlatform, rawValue] of Object.entries(links as Record<string, unknown>).slice(0, 20)) {
        const platform = rawPlatform.trim().toLowerCase();
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!value) continue;
        if (!SOCIAL_LINK_PLATFORM_SET.has(platform)) {
            return { success: false, error: 'This link type is not supported. Choose a listed service or Website.' };
        }
        const url = normalizeOptionalProfileUrl(value);
        if (!url) return { success: false, error: 'This link cannot be used because its destination is not safe.' };
        const resolved = resolveSocialPresence(platform, url);
        if (!resolved) return { success: false, error: 'This link cannot be used because its destination is not safe.' };
        if (seen.has(resolved.canonicalKey)) continue;
        seen.add(resolved.canonicalKey);
        // The URL decides its known service, preventing mismatched picker values.
        normalized[resolved.platform] = resolved.url;
    }
    return { success: true, links: normalized };
}

// ── Form State (used by EditProfileModal) ───────────────────────────

export type ProfileFormState = {
    fullName: string;
    username: string;
    headline: string;
    bio: string;
    location: string;
    website: string;
    avatarUrl: string;
    bannerUrl: string;
    openTo: string[];
    experienceLevel: string;
    hoursPerWeek: string;
    skills: string[];
    socialLinks: SocialLinkStorage;
    socialLinkMetadata: Record<string, { health: 'unknown' | 'active' | 'unavailable'; checkedAt?: string }>;
    experience: unknown[];
    education: unknown[];
    openToCustomRoles: string[];
    preferredCategories: string[];
};

/**
 * Convert a raw profile (either camelCase or snake_case) to form state.
 */
export function toFormState(profile: Record<string, unknown> | null | undefined): ProfileFormState {
    const s = (profile || {}) as Record<string, unknown>;
    return {
        fullName: str(s.fullName ?? s.full_name),
        username: str(s.username),
        headline: str(s.headline),
        bio: str(s.bio),
        location: str(s.location),
        website: str(s.website),
        avatarUrl: str(s.avatarUrl ?? s.avatar_url),
        bannerUrl: str(s.bannerUrl ?? s.banner_url),
        openTo: arr(s.openTo ?? s.open_to),
        experienceLevel: str(s.experienceLevel ?? s.experience_level),
        hoursPerWeek: str(s.hoursPerWeek ?? s.hours_per_week),
        skills: arr(s.skills),
        socialLinks: normalizeSocialLinkStorage(s.socialLinks ?? s.social_links),
        socialLinkMetadata: socialLinkMetadata(s.socialLinkMetadata ?? s.social_link_metadata),
        experience: arr(s.experience),
        education: arr(s.education),
        openToCustomRoles: arr(s.openToCustomRoles ?? s.open_to_custom_roles),
        preferredCategories: arr(s.preferredCategories ?? s.preferred_categories),
    };
}

// ── Server Payload (used by updateProfileAction) ────────────────────

export type ProfileServerPayload = {
    fullName: string;
    username: string;
    headline: string;
    bio: string;
    location: string;
    website: string;
    avatarUrl: string;
    bannerUrl: string;
    skills: string[];
    socialLinks: SocialLinkStorage;
    openTo: string[];
    experienceLevel: string | null;
    hoursPerWeek: string | null;
    education: unknown[];
    openToCustomRoles: string[];
    preferredCategories: string[];
    expectedUpdatedAt?: string;
};

/**
 * Convert form state to the server action payload format.
 */
export function toServerPayload(
    formState: ProfileFormState,
    expectedUpdatedAt?: string,
): ProfileServerPayload {
    const normalizedExpectedUpdatedAt = (() => {
        if (!expectedUpdatedAt || typeof expectedUpdatedAt !== "string") return undefined;
        const parsed = new Date(expectedUpdatedAt);
        if (!Number.isFinite(parsed.getTime())) return undefined;
        return parsed.toISOString();
    })();

    return {
        fullName: formState.fullName,
        username: formState.username,
        headline: formState.headline,
        bio: formState.bio,
        location: formState.location,
        website: formState.website,
        avatarUrl: formState.avatarUrl,
        bannerUrl: formState.bannerUrl,
        skills: formState.skills,
        socialLinks: formState.socialLinks,
        openTo: formState.openTo,
        experienceLevel: formState.experienceLevel || null,
        hoursPerWeek: formState.hoursPerWeek || null,
        education: formState.education,
        openToCustomRoles: formState.openToCustomRoles || [],
        preferredCategories: formState.preferredCategories || [],
        ...(normalizedExpectedUpdatedAt ? { expectedUpdatedAt: normalizedExpectedUpdatedAt } : {}),
    };
}

// ── Optimistic Update (used by ProfileV2Client) ─────────────────────

const OPTIMISTIC_KEYS = [
    "fullName", "username", "headline", "bio", "location", "website",
    "avatarUrl", "bannerUrl", "skills", "socialLinks",
    "openTo", "experienceLevel", "hoursPerWeek", "education",
    "openToCustomRoles", "preferredCategories",
] as const;

/**
 * Apply a server payload as an optimistic update to a live profile object.
 * Only overwrites fields that are present in `updates`.
 */
export function applyOptimisticUpdate(
    current: Record<string, unknown>,
    updates: Record<string, unknown>,
): Record<string, unknown> {
    const next = { ...current };
    for (const key of OPTIMISTIC_KEYS) {
        if (updates[key] !== undefined) {
            next[key] = updates[key];
        }
    }
    return next;
}

/**
 * Apply a server payload back onto a form-state-shaped base.
 * Used when syncing server response back to local form state.
 */
export function applyPayloadToFormBase(
    base: ProfileFormState,
    payload: Record<string, unknown>,
): ProfileFormState {
    const next = { ...base };
    for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined && k in next) {
            (next as any)[k] = Array.isArray(v) ? arr(v) : (v && typeof v === "object" ? obj(v) : str(v));
        }
    }
    return next;
}

// ── Social Links Normalization (used by ProfileRightRail) ───────────

export type NormalizedSocialLink = {
    /** Kept for existing consumers; use platformLabel in new UI. */
    label: string;
    url: string;
    platform: SocialLinkPlatform;
    platformLabel: string;
    accountLabel: string;
    iconKey: SocialPresenceIconKey | null;
    /** Stable, low-cardinality service identity for catalog-detected links. */
    serviceKey?: string;
    canonicalKey: string;
    /** Stable item identity for editing/reordering; absent for a direct resolver call. */
    id?: string;
    /** Owner-provided title, permitted for an unrecognised/custom site only. */
    customLabel?: string;
    order?: number;
};

/**
 * Converts a stored social URL into safe, display-ready data. This uses a
 * local domain registry rather than remote metadata, so profile rendering
 * does not make third-party requests or expose a visitor's browsing context.
 */
export function resolveSocialPresence(
    platformHint: string | undefined,
    rawUrl: string | undefined,
): NormalizedSocialLink | null {
    const raw = String(rawUrl || '').trim();
    if (!raw || !isSafeHttpUrl(raw)) return null;

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const hinted = String(platformHint || '').trim().toLowerCase();
    let platform: SocialLinkPlatform = SOCIAL_LINK_PLATFORM_SET.has(hinted) ? hinted as SocialLinkPlatform : 'other';
    let matchedFirstClassDomain = false;

    for (const candidate of SOCIAL_LINK_PLATFORMS) {
        const domains = SOCIAL_PRESENCE[candidate].domains;
        if (domains?.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
            platform = candidate === 'twitter' ? 'x' : candidate;
            matchedFirstClassDomain = true;
            break;
        }
    }

    const domainPresence = matchedFirstClassDomain ? null : findDomainPresence(host, parsed.pathname);
    const resolvedPlatform: SocialLinkPlatform = domainPresence ? 'other' : platform;
    const definition = domainPresence || SOCIAL_PRESENCE[platform];
    const accountLabel = socialAccountLabel(resolvedPlatform, parsed, host);
    const url = canonicalSocialUrl(parsed);
    return {
        label: definition.label,
        url,
        platform: resolvedPlatform,
        platformLabel: definition.label,
        accountLabel,
        iconKey: definition.iconKey,
        ...(domainPresence ? { serviceKey: domainPresence.key } : {}),
        canonicalKey: `${domainPresence?.key || platform}:${host}:${accountLabel.toLocaleLowerCase()}`,
    };
}

/**
 * Normalize social links from multiple possible formats into a consistent array.
 * Deduplicates by URL, capitalizes labels, and filters non-http(s) URLs.
 */
export function normalizeSocialLinks(
    profile: Record<string, unknown>,
    list?: Array<{ label?: string; url?: string; platform?: string }> | null,
): NormalizedSocialLink[] {
    const out: NormalizedSocialLink[] = [];
    const seenUrls = new Set<string>();
    const usedCanonicalKeys = new Set<string>();

    // SEC-M12: rendering-time defense in depth. The server-side zod schema
    // already passes socialLinks through `isSafeHttpUrl`, but stale rows,
    // legacy imports, and future data sources can sneak unsafe URLs in. Run
    // the same gate here so `<a href={link.url}>` can never render a
    // javascript:/data:/private-host URL.
    const add = (item: SocialLinkItem) => {
        const resolved = resolveSocialPresence(item.platform, item.url);
        if (!resolved || seenUrls.has(resolved.url)) return;
        seenUrls.add(resolved.url);
        let canonicalKey = resolved.canonicalKey;
        if (usedCanonicalKeys.has(canonicalKey)) canonicalKey = `${canonicalKey}~${item.id}`;
        usedCanonicalKeys.add(canonicalKey);
        const generic = ['website', 'portfolio', 'other'].includes(resolved.platform);
        out.push({
            ...resolved,
            ...(item.destinationLabel ? { accountLabel: item.destinationLabel } : {}),
            canonicalKey,
            id: item.id,
            order: item.order,
            ...(generic && item.label ? { customLabel: item.label } : {}),
        });
    };

    // Object format: { github: "https://...", twitter: "https://..." }
    const json = profile?.socialLinks || profile?.social_links;
    for (const item of socialLinkItemsFromStorage(json)) add(item);

    // Array or legacy table format
    if (Array.isArray(list)) {
        for (const row of list) add({ id: deterministicLinkId(`${row?.platform || row?.label || ''}:${row?.url || ''}`, out.length, new Set(out.map((link) => link.id || ''))), platform: row?.platform || row?.label || '', url: row?.url || '', order: out.length });
    } else if (list && typeof list === "object") {
        for (const item of socialLinkItemsFromStorage(list)) add(item);
    }

    return out;
}

function socialAccountLabel(platform: SocialLinkPlatform, parsed: URL, host: string): string {
    const parts = parsed.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => {
            try {
                return decodeURIComponent(part);
            } catch {
                return part;
            }
        });

    let account = ['website', 'portfolio', 'other'].includes(platform) ? host : (parts[0] || host);
    if (platform === 'github' && parts.length >= 2) account = `${parts[0]}/${parts[1]}`;
    if (platform === 'linkedin' && ['in', 'company', 'school', 'showcase'].includes(parts[0] || '')) {
        account = parts[1] || host;
    }
    if (platform === 'youtube') {
        account = parts[0] === 'channel' || parts[0] === 'user' || parts[0] === 'c' ? (parts[1] || host) : (parts[0] || host);
    }
    if (platform === 'google-scholar') {
        account = parsed.searchParams.has('user') ? 'Scholar profile' : 'Publication';
    }
    if (platform === 'doi') account = parts.join('/') || 'Publication';
    if (platform === 'arxiv') account = parts[0] === 'abs' || parts[0] === 'pdf' ? (parts[1] || 'Publication') : (parts[0] || 'Publication');
    if (platform === 'pubmed') account = parts.at(-1) || 'Publication';
    if (platform === 'researchgate' && ['profile', 'publication'].includes(parts[0] || '')) account = parts[1] || 'Research';
    if (platform === 'semantic-scholar' && parts[0] === 'paper') account = parts[1] || 'Publication';
    if (platform === 'zenodo' && ['record', 'records'].includes(parts[0] || '')) account = parts[1] || 'Publication';
    if (platform === 'mendeley' && parts[0] === 'catalogue') account = parts[1] || 'Publication';
    if ((platform === 'gitlab' || platform === 'bitbucket') && parts.length >= 2) account = `${parts[0]}/${parts[1]}`;
    if (platform === 'stackoverflow' && parts[0] === 'users') account = parts[2] || parts[1] || host;
    if (platform === 'x' && ['home', 'intent', 'share', 'search', 'i'].includes(account)) account = host;

    const normalized = account.replace(/^@/, '').replace(/[-_]+/g, ' ').trim();
    return normalized.slice(0, 80) || host;
}

function canonicalSocialUrl(parsed: URL): string {
    const url = new URL(parsed.toString());
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
}

// ── Helpers ─────────────────────────────────────────────────────────

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function arr(v: unknown): any[] {
    return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, string> {
    return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, string>)
        : {};
}

function normalizeSocialLinkStorage(value: unknown): SocialLinkStorage {
    if (Array.isArray(value)) return socialLinkItemsFromStorage(value);
    return obj(value);
}

function socialLinkMetadata(value: unknown): Record<string, { health: 'unknown' | 'active' | 'unavailable'; checkedAt?: string }> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output: Record<string, { health: 'unknown' | 'active' | 'unavailable'; checkedAt?: string }> = {};
    for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
        if (!SOCIAL_LINK_ID_RE.test(key) || !candidate || typeof candidate !== 'object') continue;
        const health = (candidate as Record<string, unknown>).health;
        if (health !== 'unknown' && health !== 'active' && health !== 'unavailable') continue;
        const checkedAt = (candidate as Record<string, unknown>).checkedAt;
        output[key] = { health, ...(typeof checkedAt === 'string' ? { checkedAt } : {}) };
    }
    return output;
}
