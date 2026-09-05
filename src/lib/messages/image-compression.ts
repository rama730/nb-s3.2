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

export function pixelsHaveTransparency(pixels: Uint8ClampedArray): boolean {
    // Check with a stride of 16 pixels (64 bytes) for fast detection across image body
    const step = 64;
    for (let alpha = 3; alpha < pixels.length; alpha += step) {
        if (pixels[alpha] !== 255) return true;
    }
    // Check image edges for border transparency
    const edgeLimit = Math.min(128, pixels.length);
    for (let alpha = 3; alpha < edgeLimit; alpha += 4) {
        if (pixels[alpha] !== 255) return true;
    }
    const endStart = Math.max(3, pixels.length - 128);
    for (let alpha = endStart; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] !== 255) return true;
    }
    return false;
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

    let bitmap: ImageBitmap | null = null;
    try {
        bitmap = await createImageBitmap(file);
        let { width, height } = bitmap;

        // Scale down if needed
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }

        let canvas = new OffscreenCanvas(width, height);
        let ctx = canvas.getContext('2d');
        if (!ctx) return file;

        ctx.drawImage(bitmap, 0, 0, width, height);

        const transparentPng = file.type === 'image/png'
            && pixelsHaveTransparency(ctx.getImageData(0, 0, width, height).data);
        let outputType = file.type === 'image/png' && !transparentPng
            ? 'image/webp'
            : file.type === 'image/png' ? 'image/png' : 'image/jpeg';

        let blob = await canvas.convertToBlob({ type: outputType, quality });
        outputType = blob.type || outputType;

        // Re-compress if still too large
        while (outputType !== 'image/png' && blob.size > maxSizeBytes && quality > MIN_QUALITY) {
            quality = Math.max(MIN_QUALITY, quality - 0.1);
            blob = await canvas.convertToBlob({ type: outputType, quality });
        }

        while (blob.size > maxSizeBytes && (width > 1 || height > 1)) {
            const ratio = Math.max(0.5, Math.min(0.9, Math.sqrt(maxSizeBytes / blob.size) * 0.95));
            width = Math.max(1, Math.floor(width * ratio));
            height = Math.max(1, Math.floor(height * ratio));
            canvas = new OffscreenCanvas(width, height);
            ctx = canvas.getContext('2d');
            if (!ctx) return file;
            ctx.drawImage(bitmap, 0, 0, width, height);
            blob = await canvas.convertToBlob({ type: outputType, quality });
        }

        // Only use compressed version if it's actually smaller
        if (blob.size > maxSizeBytes || blob.size >= file.size) return file;

        const extension = outputType === 'image/png' ? 'png' : outputType === 'image/webp' ? 'webp' : 'jpg';
        const baseName = file.name.replace(/\.[^.]+$/, '');
        return new File([blob], `${baseName}.${extension}`, { type: outputType, lastModified: file.lastModified });
    } catch {
        return file;
    } finally {
        bitmap?.close();
    }
}

export async function generateTinyThumbnail(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) return null;
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return null;

    let bitmap: ImageBitmap | null = null;
    try {
        bitmap = await createImageBitmap(file);

        // 16x16 tiny canvas for extreme compression (looks great when blurred)
        const canvas = new OffscreenCanvas(16, 16);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(bitmap, 0, 0, 16, 16);

        // Native base64 extraction at 0.1 quality for minimum byte size
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.1 });
        const buffer = await blob.arrayBuffer();

        // Convert to base64 string
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        return `data:image/jpeg;base64,${btoa(binary)}`;
    } catch (error) {
        console.error('Failed to generate tiny thumbnail:', error);
        return null;
    } finally {
        bitmap?.close();
    }
}
