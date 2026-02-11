export interface HubRankingWeights {
    candidateLimit: number;
    maxSnapshotItems: number;
    snapshotTtlSeconds: number;
    trending: {
        views: number;
        follows: number;
        saves: number;
        recency: number;
    };
    quality: {
        shortDescription: number;
        coverImage: number;
        tags: number;
        skills: number;
        lifecycle: number;
    };
    recommendation: {
        titleMatch: number;
        descriptionMatch: number;
        skillsMatch: number;
        tagsMatch: number;
        categoryMatch: number;
        trendBlend: number;
        coldStartBlend: number;
    };
    diversity: {
        ownerPenalty: number;
        categoryPenalty: number;
    };
}

const DEFAULT_WEIGHTS: HubRankingWeights = {
    candidateLimit: 280,
    maxSnapshotItems: 400,
    snapshotTtlSeconds: 180,
    trending: {
        views: 0.45,
        follows: 1.3,
        saves: 1.05,
        recency: 0.03,
    },
    quality: {
        shortDescription: 0.3,
        coverImage: 0.15,
        tags: 0.2,
        skills: 0.25,
        lifecycle: 0.1,
    },
    recommendation: {
        titleMatch: 4.5,
        descriptionMatch: 2.8,
        skillsMatch: 5.5,
        tagsMatch: 3.2,
        categoryMatch: 2,
        trendBlend: 0.35,
        coldStartBlend: 0.85,
    },
    diversity: {
        ownerPenalty: 0.55,
        categoryPenalty: 0.3,
    },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const mergeWithDefaults = (raw: Partial<HubRankingWeights>): HubRankingWeights => {
    return {
        ...DEFAULT_WEIGHTS,
        ...raw,
        candidateLimit: clamp(Number(raw.candidateLimit ?? DEFAULT_WEIGHTS.candidateLimit), 80, 1000),
        maxSnapshotItems: clamp(Number(raw.maxSnapshotItems ?? DEFAULT_WEIGHTS.maxSnapshotItems), 80, 1200),
        snapshotTtlSeconds: clamp(Number(raw.snapshotTtlSeconds ?? DEFAULT_WEIGHTS.snapshotTtlSeconds), 30, 900),
        trending: {
            ...DEFAULT_WEIGHTS.trending,
            ...(raw.trending || {}),
        },
        quality: {
            ...DEFAULT_WEIGHTS.quality,
            ...(raw.quality || {}),
        },
        recommendation: {
            ...DEFAULT_WEIGHTS.recommendation,
            ...(raw.recommendation || {}),
        },
        diversity: {
            ...DEFAULT_WEIGHTS.diversity,
            ...(raw.diversity || {}),
        },
    };
};

let cachedWeights: HubRankingWeights | null = null;

export const HUB_RANKING_SCHEMA_VERSION = 2;

export function getHubRankingWeights(): HubRankingWeights {
    if (cachedWeights) return cachedWeights;

    const raw = process.env.HUB_RANKING_WEIGHTS;
    if (!raw) {
        cachedWeights = DEFAULT_WEIGHTS;
        return cachedWeights;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<HubRankingWeights>;
        cachedWeights = mergeWithDefaults(parsed);
    } catch {
        cachedWeights = DEFAULT_WEIGHTS;
    }

    return cachedWeights;
}
