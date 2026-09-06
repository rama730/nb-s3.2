import {
    normalizeSocialLinks,
    resolveSocialPresence,
    socialLinkItemsFromStorage,
    type NormalizedSocialLink,
    type ProjectLinkAudience,
    type ProjectLinkMetadata,
    type ProjectLinkMetadataRecord,
    type ProjectLinkPurpose,
    type SocialLinkItem,
    validateSocialLinkCollection,
} from '@/lib/profile/normalization';
import { normalizeGithubRepoUrl } from '@/lib/github/repo-validation';

export type ProjectSocialLinks = SocialLinkItem[];

/** Project links use the shared resolver, but remain project-owned data. */
export function normalizeProjectSocialLinks(value: unknown): ProjectSocialLinks {
    const split = splitProjectSocialLinks(value);
    return 'error' in split ? [] : split.links;
}

/**
 * Compares the persisted, user-controlled project-link state. Object key order is
 * deliberately ignored because legacy rows and editor drafts can contain the same
 * fields in a different insertion order after defaults are hydrated.
 */
export function areProjectSocialLinksEqual(left: unknown, right: unknown): boolean {
    const leftLinks = normalizeProjectSocialLinks(left);
    const rightLinks = normalizeProjectSocialLinks(right);
    if (leftLinks.length !== rightLinks.length) return false;

    return leftLinks.every((link, index) => {
        const other = rightLinks[index];
        if (!other) return false;
        return link.id === other.id
            && link.url === other.url
            && link.platform === other.platform
            && link.label === other.label
            && link.destinationLabel === other.destinationLabel
            && link.purpose === other.purpose
            && link.audience === other.audience
            && link.order === other.order;
    });
}

/** ponytail: native text extraction covers paste and drop without a parser dependency. */
export function extractProjectLinkUrls(value: string): string[] {
    return [...value.matchAll(/https?:\/\/[^\s]+/gi)]
        .map(([url]) => url.replace(/[),.;]+$/, ''))
        .filter((url, index, urls) => urls.indexOf(url) === index);
}

export function countProjectLinkChanges(saved: unknown, draft: unknown): number {
    const savedLinks = normalizeProjectSocialLinks(saved);
    const draftLinks = normalizeProjectSocialLinks(draft);
    if (areProjectSocialLinksEqual(savedLinks, draftLinks)) return 0;
    const savedById = new Map(savedLinks.map((link) => [link.id, link]));
    const draftIds = new Set(draftLinks.map((link) => link.id));
    const addedOrEdited = draftLinks.filter((link) => {
        const previous = savedById.get(link.id);
        return !previous || !areProjectSocialLinksEqual([previous], [{ ...link, order: previous.order }]);
    }).length;
    return Math.max(1, addedOrEdited + savedLinks.filter((link) => !draftIds.has(link.id)).length);
}

export function validateProjectSocialLinks(value: unknown) {
    const split = splitProjectSocialLinks(value);
    return 'error' in split
        ? { success: false as const, error: split.error }
        : { success: true as const, links: split.links };
}

export type ResolvedProjectSocialLink = NormalizedSocialLink & {
    managed?: 'github-integration' | 'github-sync-connection' | 'github-cloned-repo';
    repositoryRole?: 'connected' | 'cloned';
    branch?: string;
    purpose: ProjectLinkPurpose;
    audience: ProjectLinkAudience;
    metadata?: ProjectLinkMetadata;
};

export type ProjectRepositoryContext = {
    importSource?: { type?: string; repoUrl?: string; branch?: string } | null;
    githubSyncConnection?: { repository?: string; branch?: string } | null;
};

export const PROJECT_LINK_PURPOSE_LABELS: Record<ProjectLinkPurpose, string> = {
    'live-product': 'Live product',
    'source-code': 'Source code',
    documentation: 'Documentation',
    'design-prototype': 'Design & prototype',
    'research-publication': 'Research & publication',
    'dataset-model': 'Dataset & model',
    'demo-media': 'Demo & media',
    community: 'Community',
    'distribution-store': 'Distribution & store',
    'roadmap-operations': 'Roadmap & operations',
    'support-contact': 'Support & contact',
    'commerce-funding': 'Commerce & funding',
    other: 'Other',
};

export function isProjectLinkMetadataStale(metadata: ProjectLinkMetadata | undefined, now = Date.now()): boolean {
    if (!metadata?.checkedAt) return false;
    const checkedAt = new Date(metadata.checkedAt).getTime();
    return Number.isFinite(checkedAt) && now - checkedAt > 30 * 24 * 60 * 60 * 1000;
}

const PLATFORM_PURPOSES: Record<string, ProjectLinkPurpose> = {
    github: 'source-code', gitlab: 'source-code', bitbucket: 'source-code', codeberg: 'source-code', stackblitz: 'source-code', codesandbox: 'source-code', replit: 'source-code',
    figma: 'design-prototype', behance: 'design-prototype', dribbble: 'design-prototype', framer: 'design-prototype', canva: 'design-prototype', miro: 'design-prototype', whimsical: 'design-prototype', maze: 'design-prototype',
    'google-scholar': 'research-publication', orcid: 'research-publication', researchgate: 'research-publication', arxiv: 'research-publication', pubmed: 'research-publication', heliyon: 'research-publication', medium: 'research-publication', substack: 'research-publication',
    youtube: 'demo-media', vimeo: 'demo-media', loom: 'demo-media', twitch: 'demo-media', instagram: 'demo-media', tiktok: 'demo-media',
    discord: 'community', slack: 'community', x: 'community', twitter: 'community', facebook: 'community', linkedin: 'community', reddit: 'community', mastodon: 'community', bluesky: 'community',
    notion: 'documentation', confluence: 'documentation', readme: 'documentation', gitbook: 'documentation', docusaurus: 'documentation',
    kaggle: 'dataset-model', huggingface: 'dataset-model', observable: 'dataset-model',
    appstore: 'distribution-store', 'google-play': 'distribution-store', producthunt: 'distribution-store', npm: 'distribution-store', pypi: 'distribution-store',
    jira: 'roadmap-operations', linear: 'roadmap-operations', trello: 'roadmap-operations', asana: 'roadmap-operations', clickup: 'roadmap-operations', monday: 'roadmap-operations',
    calendly: 'support-contact', mailto: 'support-contact',
    patreon: 'commerce-funding', kickstarter: 'commerce-funding', indiegogo: 'commerce-funding', opencollective: 'commerce-funding',
};

export function inferProjectLinkPurpose(link: Pick<NormalizedSocialLink, 'platform' | 'serviceKey' | 'url'>): ProjectLinkPurpose {
    const key = link.serviceKey || link.platform;
    if (PLATFORM_PURPOSES[key]) return PLATFORM_PURPOSES[key];
    try {
        const parsed = new URL(link.url);
        const path = parsed.pathname.toLowerCase();
        if (/\b(?:docs?|documentation|wiki|guide|manual|readme)\b/.test(path)) return 'documentation';
        if (/\b(?:demo|video|watch|showcase)\b/.test(path)) return 'demo-media';
        if (/\b(?:paper|publication|research|article|doi)\b/.test(path)) return 'research-publication';
        if (/\b(?:design|prototype|mockup|case-study)\b/.test(path)) return 'design-prototype';
        if (/\b(?:support|help|contact)\b/.test(path)) return 'support-contact';
    } catch {
        return 'other';
    }
    return ['website', 'portfolio'].includes(link.platform) ? 'live-product' : 'other';
}

export function hydrateProjectSocialLinks(value: unknown, metadata: ProjectLinkMetadataRecord = {}): SocialLinkItem[] {
    return socialLinkItemsFromStorage(value).map((link) => ({
        ...link,
        ...(link.metadata || metadata[link.id] ? { metadata: link.metadata || metadata[link.id] } : {}),
    }));
}

/** Separates editable intent from derived preview/health state before persistence. */
export function splitProjectSocialLinks(
    value: unknown,
    existingMetadata: ProjectLinkMetadataRecord = {},
): { links: SocialLinkItem[]; metadata: ProjectLinkMetadataRecord } | { error: string } {
    const validation = validateSocialLinkCollection(value);
    if (!validation.success) return { error: validation.error };
    const metadata: ProjectLinkMetadataRecord = {};
    const links = validation.links.map(({ metadata: draftMetadata, ...link }) => {
        const resolved = resolveSocialPresence(link.platform, link.url);
        const purpose = link.purpose || (resolved ? inferProjectLinkPurpose(resolved) : 'other');
        const combined = draftMetadata || existingMetadata[link.id];
        if (combined) metadata[link.id] = combined;
        return { ...link, purpose, audience: link.audience === 'members' ? 'members' as const : 'public' as const };
    });
    return { links, metadata };
}

export function filterProjectLinksForAudience(value: unknown, canViewMemberLinks: boolean): SocialLinkItem[] {
    return socialLinkItemsFromStorage(value).filter((link) => link.audience !== 'members' || canViewMemberLinks);
}

function isConnectedRepositoryRoot(link: ResolvedProjectSocialLink, repositoryUrl: string) {
    try {
        const repo = new URL(repositoryUrl);
        const candidate = new URL(link.url);
        return candidate.hostname.toLowerCase() === repo.hostname.toLowerCase()
            && candidate.pathname.replace(/\/+$/, '').toLowerCase() === repo.pathname.replace(/\/+$/, '').toLowerCase();
    } catch {
        return false;
    }
}

/**
 * One project-link read model. Supports both active Files Tab sync connections
 * and cloned repository origins, resolving them cleanly without collision.
 */
export function resolveProjectSocialLinks(
    value: unknown,
    githubRepoUrl?: string | null,
    context?: ProjectRepositoryContext | null,
): ResolvedProjectSocialLink[] {
    const storedById = new Map(socialLinkItemsFromStorage(value).map((item) => [item.id, item]));
    const links: ResolvedProjectSocialLink[] = normalizeSocialLinks({ socialLinks: value }).map((link) => {
        const stored = link.id ? storedById.get(link.id) : undefined;
        return {
            ...link,
            purpose: stored?.purpose || inferProjectLinkPurpose(link),
            audience: stored?.audience === 'members' ? 'members' : 'public',
            ...(stored?.metadata ? { metadata: stored.metadata } : {}),
        };
    });

    if (context) {
        const result: ResolvedProjectSocialLink[] = [];
        const addedUrls = new Set<string>();

        // 1. Truly connected repository in Files Tab
        if (context.githubSyncConnection?.repository) {
            const rawRepo = context.githubSyncConnection.repository.trim();
            const connectedUrl = rawRepo.startsWith('http') ? rawRepo : `https://github.com/${rawRepo.replace(/^\/+/, '')}`;
            const repository = resolveSocialPresence('github', normalizeGithubRepoUrl(connectedUrl) || undefined);
            if (repository) {
                result.push({
                    ...repository,
                    id: 'github-sync-connection',
                    managed: 'github-sync-connection',
                    repositoryRole: 'connected',
                    branch: context.githubSyncConnection.branch || 'main',
                    purpose: 'source-code',
                    audience: 'public',
                });
                addedUrls.add(repository.url.toLowerCase());
            }
        }

        // 2. Cloned repository origin (from importSource)
        if (context.importSource?.type === 'github' && context.importSource.repoUrl) {
            const repository = resolveSocialPresence('github', normalizeGithubRepoUrl(context.importSource.repoUrl) || undefined);
            if (repository && !addedUrls.has(repository.url.toLowerCase())) {
                result.push({
                    ...repository,
                    id: 'github-cloned-repo',
                    managed: 'github-cloned-repo',
                    repositoryRole: 'cloned',
                    branch: context.importSource.branch || 'main',
                    purpose: 'source-code',
                    audience: 'public',
                });
                addedUrls.add(repository.url.toLowerCase());
            }
        }

        if (result.length > 0) {
            const filteredLinks = links.filter((link) => !Array.from(addedUrls).some((url) => isConnectedRepositoryRoot(link, url)));
            return [...result, ...filteredLinks];
        }
    }

    const repository = resolveSocialPresence('github', normalizeGithubRepoUrl(githubRepoUrl || '') || undefined);
    if (!repository) return links;

    return [
        { ...repository, id: 'github-integration', managed: 'github-integration', repositoryRole: 'connected', purpose: 'source-code', audience: 'public' },
        ...links.filter((link) => !isConnectedRepositoryRoot(link, repository.url)),
    ];
}
