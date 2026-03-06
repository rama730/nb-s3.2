import { compressAvatar } from '@/lib/services/avatar-service'

type WorkerResponse =
    | { ok: true; blob: Blob }
    | { ok: false; error: string }

export async function compressAvatarOffMainThread(file: File): Promise<Blob> {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
        return compressAvatar(file)
    }

    return new Promise<Blob>((resolve, reject) => {
        const worker = new Worker(new URL('../../workers/avatar-compress.worker.ts', import.meta.url))

        const cleanup = () => {
            worker.onmessage = null
            worker.onerror = null
            worker.terminate()
        }

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const payload = event.data
            cleanup()
            if (payload?.ok) {
                resolve(payload.blob)
                return
            }
            reject(new Error(payload?.error || 'Compression failed'))
        }

        worker.onerror = () => {
            cleanup()
            reject(new Error('Worker compression failed'))
        }

        worker.postMessage({ file, quality: 0.85, size: 400 })
    }).catch(async () => compressAvatar(file))
}
