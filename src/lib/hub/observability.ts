interface HubMetricEvent {
    view: string;
    viewerType: 'anon' | 'user';
    durationMs: number;
    projectCount: number;
    hasMore: boolean;
    cacheHit: boolean;
    strategy: 'snapshot' | 'direct';
    filtersFingerprint: string;
}

const SAMPLE_RATE = 0.2;

const shouldEmit = () => {
    if (process.env.NODE_ENV !== 'production') return true;
    return Math.random() <= SAMPLE_RATE;
};

export function recordHubMetric(event: HubMetricEvent) {
    if (!shouldEmit()) return;
    // Structured logs for ingestion by hosting platform log pipelines.
    console.info('[hub-metric]', JSON.stringify(event));
}
