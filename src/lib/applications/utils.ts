import type { ApplicationLifecycleStatus } from '@/lib/applications/status';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const APPLICATION_LINK_LABELS = [
    { hostIncludes: 'github.com', label: 'GitHub' },
    { hostIncludes: 'linkedin.com', label: 'LinkedIn' },
    { hostIncludes: 'gitlab.com', label: 'GitLab' },
] as const;

function getLinkTypeLabel(hostnameOrRaw: string) {
    const value = hostnameOrRaw.toLowerCase();
    const matched = APPLICATION_LINK_LABELS.find((item) => value.includes(item.hostIncludes));
    return matched?.label || 'Link';
}

function normalizeTypedLinkLine(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    const looksLikeLink = /^https?:\/\//i.test(trimmed) || /[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed);
    if (!looksLikeLink) return null;
    const firstToken = trimmed.split(/\s+/)[0];
    const candidate = /^https?:\/\//i.test(firstToken) ? firstToken : `https://${firstToken}`;

    try {
        const parsed = new URL(candidate);
        const label = getLinkTypeLabel(parsed.hostname);
        return `${label}: ${parsed.toString()}`;
    } catch {
        const label = getLinkTypeLabel(firstToken);
        return `${label}: ${trimmed}`;
    }
}

export function calculateCooldown(updatedAt: Date, nowMs: number = Date.now()): { canApply: boolean; waitTime?: string } {
    const elapsed = nowMs - new Date(updatedAt).getTime();

    if (elapsed >= COOLDOWN_MS) {
        return { canApply: true };
    }

    const remaining = COOLDOWN_MS - elapsed;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    return { canApply: false, waitTime: `${hours}h ${minutes}m` };
}

export function normalizeApplicationMessageText(raw: string) {
    const text = (raw || '').trim();
    if (!text) return '';

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const normalized: string[] = [];
    let availabilityLine: string | null = null;

    for (const line of lines) {
        if (/^availability\s*:/i.test(line)) {
            if (!availabilityLine) {
                const value = line.replace(/^availability\s*:/i, '').trim();
                if (value) availabilityLine = `Availability: ${value}`;
            }
            continue;
        }

        const normalizedLink = normalizeTypedLinkLine(line);
        if (normalizedLink) {
            normalized.push(normalizedLink);
            continue;
        }

        normalized.push(line);
    }

    const deduped = normalized.filter((line, index, arr) => arr.indexOf(line) === index);
    const output = [...deduped, ...(availabilityLine ? [availabilityLine] : [])]
        .join('\n\n')
        .trim();

    return output.slice(0, 2000);
}

export function resolveLifecycleStatus(
    status: 'accepted' | 'rejected' | 'pending',
    decisionReason?: string | null,
): ApplicationLifecycleStatus {
    if (status === 'pending') return 'pending';
    if (status === 'accepted') return 'accepted';
    if (decisionReason === 'withdrawn_by_applicant') return 'withdrawn';
    if (decisionReason === 'role_filled') return 'role_filled';
    return 'rejected';
}
