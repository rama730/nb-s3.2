"use client";

import { createClient } from "@/lib/supabase/client";

export type SupabaseSignedUploadSession = {
    bucket: string;
    storagePath: string;
    uploadToken: string;
    contentType: string;
};

export async function uploadToSupabaseSignedUrl(
    session: SupabaseSignedUploadSession,
    file: Blob,
    options: { cacheProfile?: "revalidate" | "immutable" } = {},
) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
        .from(session.bucket)
        .uploadToSignedUrl(session.storagePath, session.uploadToken, file, {
            cacheControl: options.cacheProfile === "immutable" ? "31536000" : "3600",
            contentType: session.contentType,
        });

    if (error) {
        throw new Error(error.message || "Failed to upload file.");
    }
    if (!data || (!data.path && !data.fullPath)) {
        throw new Error("Upload succeeded with no data returned.");
    }

    return data;
}
