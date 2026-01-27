/**
 * Avatar Service - Optimized
 * Shows immediate preview, uploads in background
 */

/**
 * Compress and resize image to 400x400 JPEG
 */
export async function compressAvatar(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
            reject(new Error('Canvas not supported'))
            return
        }

        img.onload = () => {
            const size = 400
            const minDim = Math.min(img.width, img.height)
            const sx = (img.width - minDim) / 2
            const sy = (img.height - minDim) / 2

            canvas.width = size
            canvas.height = size

            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size)

            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob)
                    else reject(new Error('Compression failed'))
                },
                'image/jpeg',
                0.85
            )
        }

        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = URL.createObjectURL(file)
    })
}

/**
 * Convert file to data URL for immediate preview
 */
export function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

/**
 * Upload avatar with immediate preview
 * Returns preview URL immediately, uploads in background
 */
export async function uploadAvatarWithPreview(
    supabase: ReturnType<typeof import('@/lib/supabase/client').createClient>,
    userId: string,
    file: File,
    onPreview: (previewUrl: string) => void,
    onUploaded?: (finalUrl: string) => void
): Promise<{ success: boolean; error?: string }> {
    try {
        // 1. Show immediate preview
        const previewUrl = await fileToDataUrl(file)
        onPreview(previewUrl)

        // 2. Compress image
        const compressedBlob = await compressAvatar(file)

        // 3. Upload to storage
        const fileName = `${userId}-${Date.now()}.jpg`

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, compressedBlob, {
                contentType: 'image/jpeg',
                upsert: true,
            })

        if (uploadError) {
            console.log('Storage upload skipped:', uploadError.message)
            // Keep using preview URL (data URL) - works fine for onboarding
            return { success: true }
        }

        // 4. Get public URL and update
        const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName)

        if (onUploaded) {
            onUploaded(publicUrl)
        }

        return { success: true }
    } catch (error) {
        console.error('Avatar error:', error)
        return { success: false, error: 'Failed to process image' }
    }
}

/**
 * Simple upload avatar (original API maintained for compatibility)
 */
export async function uploadAvatar(
    supabase: ReturnType<typeof import('@/lib/supabase/client').createClient>,
    userId: string,
    file: File
): Promise<{ url: string | null; error: string | null }> {
    try {
        // Get preview URL first (always works)
        const previewUrl = await fileToDataUrl(file)

        // Try to compress and upload
        try {
            const compressedBlob = await compressAvatar(file)
            const fileName = `${userId}-${Date.now()}.jpg`

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, compressedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true,
                })

            if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage
                    .from('avatars')
                    .getPublicUrl(fileName)
                return { url: publicUrl, error: null }
            }
        } catch (e) {
            console.log('Upload failed, using preview:', e)
        }

        // Fallback to preview URL
        return { url: previewUrl, error: null }
    } catch (error) {
        console.error('Avatar error:', error)
        return { url: null, error: 'Failed to process image' }
    }
}
