type MetricPayload = Record<string, unknown>
type MetricKind = 'counter' | 'histogram'

type QueuedMetric = {
    name: string
    value: number
    kind: MetricKind
    attributes: Array<{ key: string; value: { stringValue?: string; boolValue?: boolean; doubleValue?: number } }>
}

const FLUSH_INTERVAL_MS = 5_000
const MAX_BATCH_SIZE = 64
const SERVICE_NAME = process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME || process.env.OTEL_SERVICE_NAME || 'nb-s3'

const queue: QueuedMetric[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let inFlightFlush: Promise<void> | null = null
let hasLoggedExporterFailure = false

function resolveMetricsEndpoint() {
    const configured = typeof window === 'undefined'
        ? process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        : process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT

    if (!configured) return null
    return configured.endsWith('/v1/metrics')
        ? configured
        : `${configured.replace(/\/$/, '')}/v1/metrics`
}

function sanitizeMetricName(name: string) {
    return name.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function toAttributeValue(value: unknown) {
    if (typeof value === 'boolean') {
        return { boolValue: value }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return { doubleValue: value }
    }
    return { stringValue: String(value) }
}

function toAttributes(payload: MetricPayload) {
    return Object.entries(payload)
        .filter(([key, value]) => key !== 'value' && value !== null && value !== undefined)
        .slice(0, 24)
        .map(([key, value]) => ({
            key,
            value: toAttributeValue(value),
        }))
}

function inferMetricKind(name: string, value: number): MetricKind {
    const lowered = name.toLowerCase()
    if (
        lowered.endsWith('.ms')
        || lowered.includes('duration')
        || lowered.includes('latency')
        || lowered.includes('ttfb')
        || lowered.includes('load')
    ) {
        return 'histogram'
    }
    if (value < 0) {
        return 'histogram'
    }
    return 'counter'
}

function toUnixTimeNanos(timestampMs: number) {
    return String(BigInt(Math.max(0, timestampMs)) * BigInt(1_000_000))
}

function buildMetricRecord(metric: QueuedMetric, nowMs: number) {
    const baseDataPoint = {
        attributes: metric.attributes,
        timeUnixNano: toUnixTimeNanos(nowMs),
    }

    if (metric.kind === 'histogram') {
        return {
            name: sanitizeMetricName(metric.name),
            unit: metric.name.toLowerCase().includes('.ms') ? 'ms' : '1',
            histogram: {
                aggregationTemporality: 2,
                dataPoints: [
                    {
                        ...baseDataPoint,
                        count: '1',
                        sum: metric.value,
                        bucketCounts: ['0', '1'],
                        explicitBounds: [metric.value],
                    },
                ],
            },
        }
    }

    return {
        name: sanitizeMetricName(metric.name),
        unit: '1',
        sum: {
            aggregationTemporality: 2,
            isMonotonic: true,
            dataPoints: [
                {
                    ...baseDataPoint,
                    asDouble: metric.value,
                },
            ],
        },
    }
}

async function flushMetrics() {
    const endpoint = resolveMetricsEndpoint()
    if (!endpoint || queue.length === 0) return
    if (inFlightFlush) {
        await inFlightFlush
        return
    }

    const batch = queue.splice(0, MAX_BATCH_SIZE)
    const nowMs = Date.now()
    const body = {
        resourceMetrics: [
            {
                resource: {
                    attributes: [
                        {
                            key: 'service.name',
                            value: { stringValue: SERVICE_NAME },
                        },
                    ],
                },
                scopeMetrics: [
                    {
                        scope: {
                            name: 'nb-s3.logger',
                            version: '1',
                        },
                        metrics: batch.map((metric) => buildMetricRecord(metric, nowMs)),
                    },
                ],
            },
        ],
    }

    inFlightFlush = fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        keepalive: true,
    })
        .then(async (response) => {
            if (response.ok) {
                hasLoggedExporterFailure = false
                return
            }

            if (!hasLoggedExporterFailure) {
                hasLoggedExporterFailure = true
                console.warn('[otlp] metric export failed', {
                    status: response.status,
                    statusText: response.statusText,
                })
            }
        })
        .catch((error) => {
            if (!hasLoggedExporterFailure) {
                hasLoggedExporterFailure = true
                console.warn('[otlp] metric export failed', {
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        })
        .finally(() => {
            inFlightFlush = null
            if (queue.length > 0) {
                scheduleFlush()
            }
        })

    await inFlightFlush
}

function scheduleFlush() {
    if (flushTimer || queue.length === 0) return
    flushTimer = setTimeout(() => {
        flushTimer = null
        void flushMetrics()
    }, FLUSH_INTERVAL_MS)
}

export function recordOtlpMetric(name: string, payload: MetricPayload) {
    if (!resolveMetricsEndpoint()) return

    const rawValue = typeof payload.value === 'number' && Number.isFinite(payload.value) ? payload.value : 1
    queue.push({
        name,
        value: rawValue,
        kind: inferMetricKind(name, rawValue),
        attributes: toAttributes(payload),
    })

    if (queue.length >= MAX_BATCH_SIZE) {
        void flushMetrics()
        return
    }

    scheduleFlush()
}
