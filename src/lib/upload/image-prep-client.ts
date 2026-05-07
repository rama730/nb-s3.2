"use client";

export type PreparedImageUpload = {
    blob: Blob;
    contentType: string;
    originalSize: number;
    optimizedSize: number;
    optimized: boolean;
};

type PrepareImageOptions = {
    maxBytes: number;
    maxWidth: number;
    maxHeight: number;
    outputType?: "image/jpeg" | "image/webp";
};

type PrepareCoverImageOptions = {
    maxBytes: number;
    width: number;
    height: number;
    focalX: number;
    focalY: number;
    outputType?: "image/jpeg" | "image/webp";
};

type PrepareProjectImageOptions = {
    maxBytes: number;
    size: number;
    previewSize: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
    outputType?: "image/jpeg" | "image/webp";
};

function loadImage(file: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Failed to read image."));
        };
        image.src = objectUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Failed to optimize image."));
                return;
            }
            resolve(blob);
        }, type, quality);
    });
}

function assertPositiveImageDimension(value: number, label: string) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive image dimension.`);
    }
}

export async function prepareImageForUpload(
    file: File,
    options: PrepareImageOptions,
): Promise<PreparedImageUpload> {
    const inputType = file.type || "application/octet-stream";
    if (file.size <= options.maxBytes && inputType !== "image/heic" && inputType !== "image/heif") {
        return {
            blob: file,
            contentType: inputType,
            originalSize: file.size,
            optimizedSize: file.size,
            optimized: false,
        };
    }

    const image = await loadImage(file);
    const outputType = options.outputType ?? "image/jpeg";
    const baseScale = Math.min(
        1,
        options.maxWidth / Math.max(1, image.naturalWidth),
        options.maxHeight / Math.max(1, image.naturalHeight),
    );
    const scaleSteps = [baseScale, baseScale * 0.85, baseScale * 0.7, baseScale * 0.55].filter((scale) => scale > 0);
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];

    for (const scale of scaleSteps) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Image optimization is not supported in this browser.");
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        for (const quality of qualitySteps) {
            const blob = await canvasToBlob(canvas, outputType, quality);
            if (blob.size <= options.maxBytes) {
                return {
                    blob,
                    contentType: outputType,
                    originalSize: file.size,
                    optimizedSize: blob.size,
                    optimized: true,
                };
            }
        }
    }

    throw new Error("Image is too large to upload. Please choose a smaller image.");
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function getCoverDrawState(image: HTMLImageElement, size: number, previewSize: number, zoom: number, offsetX: number, offsetY: number) {
    const safeSize = Math.max(1, size);
    const safePreviewSize = Math.max(1, previewSize);
    const safeZoom = clamp(zoom, 1, 4);
    const basePreviewScale = Math.max(
        safePreviewSize / Math.max(1, image.naturalWidth),
        safePreviewSize / Math.max(1, image.naturalHeight),
    );
    const previewWidth = image.naturalWidth * basePreviewScale * safeZoom;
    const previewHeight = image.naturalHeight * basePreviewScale * safeZoom;
    const maxPreviewOffsetX = Math.max(0, (previewWidth - safePreviewSize) / 2);
    const maxPreviewOffsetY = Math.max(0, (previewHeight - safePreviewSize) / 2);
    const clampedPreviewOffsetX = clamp(offsetX, -maxPreviewOffsetX, maxPreviewOffsetX);
    const clampedPreviewOffsetY = clamp(offsetY, -maxPreviewOffsetY, maxPreviewOffsetY);
    const outputOffsetX = (clampedPreviewOffsetX / safePreviewSize) * safeSize;
    const outputOffsetY = (clampedPreviewOffsetY / safePreviewSize) * safeSize;
    const baseOutputScale = Math.max(
        safeSize / Math.max(1, image.naturalWidth),
        safeSize / Math.max(1, image.naturalHeight),
    );
    const drawWidth = image.naturalWidth * baseOutputScale * safeZoom;
    const drawHeight = image.naturalHeight * baseOutputScale * safeZoom;

    return {
        drawX: (safeSize - drawWidth) / 2 + outputOffsetX,
        drawY: (safeSize - drawHeight) / 2 + outputOffsetY,
        drawWidth,
        drawHeight,
    };
}

export async function prepareCoverImageForUpload(
    file: File,
    options: PrepareCoverImageOptions,
): Promise<PreparedImageUpload> {
    const image = await loadImage(file);
    const outputType = options.outputType ?? "image/jpeg";
    assertPositiveImageDimension(options.width, "Target width");
    assertPositiveImageDimension(options.height, "Target height");
    assertPositiveImageDimension(image.naturalWidth, "Source image width");
    assertPositiveImageDimension(image.naturalHeight, "Source image height");
    const targetRatio = options.width / options.height;
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (sourceRatio > targetRatio) {
        sourceWidth = image.naturalHeight * targetRatio;
        sourceX = clamp(
            (image.naturalWidth - sourceWidth) * (options.focalX / 100),
            0,
            image.naturalWidth - sourceWidth,
        );
    } else {
        sourceHeight = image.naturalWidth / targetRatio;
        sourceY = clamp(
            (image.naturalHeight - sourceHeight) * (options.focalY / 100),
            0,
            image.naturalHeight - sourceHeight,
        );
    }

    const sizeSteps = [1, 0.85, 0.7, 0.55].map((scale) => ({
        width: Math.max(1, Math.round(options.width * scale)),
        height: Math.max(1, Math.round(options.height * scale)),
    }));
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];

    for (const size of sizeSteps) {
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Image adjustment is not supported in this browser.");
        }
        context.drawImage(
            image,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            size.width,
            size.height,
        );

        for (const quality of qualitySteps) {
            const blob = await canvasToBlob(canvas, outputType, quality);
            if (blob.size <= options.maxBytes) {
                return {
                    blob,
                    contentType: outputType,
                    originalSize: file.size,
                    optimizedSize: blob.size,
                    optimized: blob.size !== file.size || outputType !== file.type,
                };
            }
        }
    }

    throw new Error("Image is too large to upload. Please choose a smaller image.");
}

export async function prepareProjectImageForUpload(
    file: File,
    options: PrepareProjectImageOptions,
): Promise<PreparedImageUpload> {
    const image = await loadImage(file);
    const outputType = options.outputType ?? "image/jpeg";
    const sizeSteps = [1, 0.85, 0.7, 0.55].map((scale) => Math.max(1, Math.round(options.size * scale)));
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];

    for (const size of sizeSteps) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Image adjustment is not supported in this browser.");
        }

        const drawState = getCoverDrawState(
            image,
            size,
            options.previewSize,
            options.zoom,
            options.offsetX,
            options.offsetY,
        );
        context.fillStyle = "#0a0a0a";
        context.fillRect(0, 0, size, size);
        context.drawImage(
            image,
            drawState.drawX,
            drawState.drawY,
            drawState.drawWidth,
            drawState.drawHeight,
        );

        for (const quality of qualitySteps) {
            const blob = await canvasToBlob(canvas, outputType, quality);
            if (blob.size <= options.maxBytes) {
                return {
                    blob,
                    contentType: outputType,
                    originalSize: file.size,
                    optimizedSize: blob.size,
                    optimized: blob.size !== file.size || outputType !== file.type,
                };
            }
        }
    }

    throw new Error("Image is too large to upload. Please choose a smaller image.");
}
