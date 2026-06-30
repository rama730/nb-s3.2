export interface MediaDimensions {
    width: number;
    height: number;
}

export const MESSAGE_MEDIA_INLINE_BOUNDS = {
    maxWidth: 320,
    maxHeight: 360,
} as const;

export const MESSAGE_MEDIA_PREVIEW_MAX_WIDTH = 760;

interface MediaBounds {
    maxWidth: number;
    maxHeight: number;
}

const MAX_MEDIA_DIMENSION = 100_000;
const METADATA_TIMEOUT_MS = 8_000;

function normalizeDimension(value: unknown): number | null {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) return null;

    const roundedValue = Math.round(numericValue);
    return roundedValue > 0 && roundedValue <= MAX_MEDIA_DIMENSION
        ? roundedValue
        : null;
}

export function normalizeMediaDimensions(
    width: unknown,
    height: unknown,
): MediaDimensions | null {
    const normalizedWidth = normalizeDimension(width);
    const normalizedHeight = normalizeDimension(height);

    return normalizedWidth && normalizedHeight
        ? { width: normalizedWidth, height: normalizedHeight }
        : null;
}

export function fitMediaWithinBounds(
    dimensions: MediaDimensions,
    bounds: MediaBounds,
): MediaDimensions {
    const scale = Math.min(
        1,
        bounds.maxWidth / dimensions.width,
        bounds.maxHeight / dimensions.height,
    );

    return {
        width: Math.max(1, Math.round(dimensions.width * scale)),
        height: Math.max(1, Math.round(dimensions.height * scale)),
    };
}

async function readImageDimensions(file: File): Promise<MediaDimensions | null> {
    if (typeof createImageBitmap !== 'function') return null;

    const bitmap = await createImageBitmap(file);
    try {
        return normalizeMediaDimensions(bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
}

function readVideoDimensions(file: File): Promise<MediaDimensions | null> {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        let settled = false;

        const finish = (dimensions: MediaDimensions | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(dimensions);
        };

        const timeoutId = window.setTimeout(() => finish(null), METADATA_TIMEOUT_MS);
        video.preload = 'metadata';
        video.muted = true;
        video.onloadedmetadata = () => finish(normalizeMediaDimensions(video.videoWidth, video.videoHeight));
        video.onerror = () => finish(null);
        video.src = objectUrl;
        video.load();
    });
}

export async function readMediaDimensions(file: File): Promise<MediaDimensions | null> {
    try {
        if (file.type.startsWith('image/')) {
            return await readImageDimensions(file);
        }
        if (file.type.startsWith('video/')) {
            return await readVideoDimensions(file);
        }
        return null;
    } catch {
        return null;
    }
}
