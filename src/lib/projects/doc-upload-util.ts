import { createProjectDocAssetUploadUrlAction, finalizeProjectDocAssetUploadAction } from "@/app/actions/project";
import { buildProjectDocImageMarkdown, type ProjectDocImageIntent } from "@/lib/projects/doc-media";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { PROJECT_DOC_ALLOWED_IMAGE_MIME_TYPES, PROJECT_DOC_ASSET_MAX_BYTES } from "@/lib/projects/doc";

export async function uploadProjectDocAsset({
    projectId,
    file,
    altText,
    imageIntent = "screenshot",
    displayWidth = null,
    caption = "",
    onProgress
}: {
    projectId: string;
    file: File;
    altText: string;
    imageIntent?: ProjectDocImageIntent;
    displayWidth?: number | null;
    caption?: string;
    onProgress?: (progress: number) => void;
}): Promise<string> {
    if (!PROJECT_DOC_ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
        throw new Error("Use JPG, PNG, WebP, or GIF images for Doc media.");
    }
    if (file.size > PROJECT_DOC_ASSET_MAX_BYTES) {
        throw new Error("File exceeds max size limit.");
    }

    onProgress?.(18);
    const upload = await createProjectDocAssetUploadUrlAction(projectId, {
        mimeType: file.type,
        sizeBytes: file.size,
        altText,
        width: null,
        height: null,
    });
    
    if (!upload.success) throw new Error(upload.error);
    
    onProgress?.(55);
    await uploadToSupabaseSignedUrl({
        bucket: upload.bucket,
        storagePath: upload.storagePath,
        uploadToken: upload.uploadToken,
        contentType: upload.contentType,
    }, file);

    onProgress?.(88);
    const finalized = await finalizeProjectDocAssetUploadAction(projectId, {
        uploadIntentId: upload.uploadIntentId,
        altText,
        width: null,
        height: null,
    });

    if (!finalized.success) throw new Error(finalized.error);
    
    onProgress?.(100);
    const assetSrc = finalized.asset?.id
        ? `/api/v1/projects/${projectId}/doc-assets/${finalized.asset.id}`
        : finalized.markdown.match(/\]\(([^)]+)\)/)?.[1] ?? "";
        
    const markdown = buildProjectDocImageMarkdown({
        src: assetSrc,
        alt: altText,
        intent: imageIntent,
        width: displayWidth,
        height: null,
        caption,
    });
    
    return `\n${markdown || finalized.markdown}\n`;
}
