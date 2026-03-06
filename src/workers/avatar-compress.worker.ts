/// <reference lib="webworker" />

const AVATAR_SIZE = 400

type CompressRequest = {
    file: File
    quality?: number
    size?: number
}

type CompressResponse =
    | { ok: true; blob: Blob }
    | { ok: false; error: string }

async function compressInWorker(file: File, size = AVATAR_SIZE, quality = 0.85): Promise<Blob> {
    if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('OffscreenCanvas not supported')
    }

    const bitmap = await createImageBitmap(file)
    const minDim = Math.min(bitmap.width, bitmap.height)
    const sx = Math.max(0, (bitmap.width - minDim) / 2)
    const sy = Math.max(0, (bitmap.height - minDim) / 2)

    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not available')

    ctx.drawImage(bitmap, sx, sy, minDim, minDim, 0, 0, size, size)
    bitmap.close()

    const blob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality,
    })

    return blob
}

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
    try {
        const { file, quality, size } = event.data
        const blob = await compressInWorker(file, size, quality)
        const response: CompressResponse = { ok: true, blob }
        self.postMessage(response)
    } catch (error) {
        const response: CompressResponse = {
            ok: false,
            error: error instanceof Error ? error.message : 'Compression failed',
        }
        self.postMessage(response)
    }
}

export {}
