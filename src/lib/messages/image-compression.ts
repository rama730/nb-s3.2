const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_MAX_HEIGHT = 1920;
const DEFAULT_QUALITY = 0.8;
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MIN_QUALITY = 0.4;
const SKIP_BELOW_BYTES = 200 * 1024;

interface CompressionOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    maxSizeBytes?: number;
}

export async function compressImage(file: File, options?: CompressionOptions): Promise<File> {
    // Skip non-images, GIFs, SVGs, and small files
    if (!file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
    if (file.size <= SKIP_BELOW_BYTES) return file;

    const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
    const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT;
    const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
    let quality = options?.quality ?? DEFAULT_QUALITY;

    try {
        const bitmap = await createImageBitmap(file);
        let { width, height } = bitmap;

        // Scale down if needed
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;

        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        // Determine output type
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

        let blob = await canvas.convertToBlob({ type: outputType, quality });

        // Re-compress if still too large
        while (blob.size > maxSizeBytes && quality > MIN_QUALITY) {
            quality -= 0.1;
            blob = await canvas.convertToBlob({ type: outputType, quality });
        }

        // Only use compressed version if it's actually smaller
        if (blob.size >= file.size) return file;

        const extension = outputType === 'image/png' ? 'png' : 'jpg';
        const baseName = file.name.replace(/\.[^.]+$/, '');
        return new File([blob], `${baseName}.${extension}`, { type: outputType, lastModified: Date.now() });
    } catch {
        return file;
    }
}
