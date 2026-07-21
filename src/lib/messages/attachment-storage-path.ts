export function extractStoragePathFromAttachmentUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        const pathMarkers = [
            '/object/sign/chat-attachments/',
            '/render/image/sign/chat-attachments/',
        ];

        for (const marker of pathMarkers) {
            const markerIndex = parsed.pathname.indexOf(marker);
            if (markerIndex < 0) continue;
            const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
            return decodeURIComponent(encodedPath);
        }

        return null;
    } catch {
        return null;
    }
}

export function resolveAttachmentStoragePath(input: {
    storagePath?: string | null;
    url?: string | null;
}) {
    return input.storagePath || extractStoragePathFromAttachmentUrl(input.url || null);
}
