-- ============================================================================
-- CHAT ATTACHMENTS STORAGE BUCKET
-- Run this in Supabase SQL Editor after the main migration
-- ============================================================================

-- Create the storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'chat-attachments',
    'chat-attachments',
    false,  -- Private bucket (accessed via signed URLs)
    52428800,  -- 50MB max file size
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ]
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

-- Allow authenticated users to upload files to their own folder
CREATE POLICY "Users can upload chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'chat-attachments' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to read attachments from conversations they participate in
-- This requires checking the message_attachments and conversation_participants tables
CREATE POLICY "Users can view chat attachments in their conversations"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
        SELECT 1 FROM public.message_attachments ma
        JOIN public.messages m ON m.id = ma.message_id
        JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
        WHERE ma.url LIKE '%' || name
        AND cp.user_id = auth.uid()
    )
);

-- Allow users to delete their own uploaded attachments
CREATE POLICY "Users can delete their own attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================================
-- HELPER FUNCTION: Generate thumbnail URL
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_thumbnail_url(original_url TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Supabase Storage provides automatic image transformations
    -- This adds transformation parameters for thumbnails
    IF original_url LIKE '%/storage/v1/object/%' THEN
        RETURN REPLACE(original_url, '/object/', '/render/image/') || '?width=200&height=200&resize=cover';
    END IF;
    RETURN original_url;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
