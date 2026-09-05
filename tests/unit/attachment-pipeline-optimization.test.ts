import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('sendMessageWithAttachments: embeds deterministic attachment and reply descriptors into messages.metadata', () => {
    const filePath = path.join(process.cwd(), 'src/app/actions/messaging/_all.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Ensure deterministic UUID generation before message insertion
    assert.ok(
        content.includes('attachmentsWithIds = claimedAttachments.map'),
        'sendMessageWithAttachments must assign deterministic UUIDs to attachments before insert'
    );
    assert.ok(
        content.includes('metadataAttachments = attachmentsWithIds.map'),
        'sendMessageWithAttachments must prepare metadataAttachments for Realtime broadcast'
    );
    assert.ok(
        content.includes('attachments: metadataAttachments'),
        'messages.metadata must include attachments array for instant Realtime push'
    );
    assert.ok(
        content.includes('replyPreview ? { replyPreview } : {}'),
        'messages.metadata must include replyPreview for instant Realtime push'
    );
});

test('useMessagesV2Realtime: buildThreadMessageFromRealtimePayload unpacks attachments and does not drop media', () => {
    const filePath = path.join(process.cwd(), 'src/hooks/useMessagesV2Realtime.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Ensure Realtime no longer drops media messages or replies
    assert.ok(
        !content.includes('if (replyToMessageId || type === \'image\' || type === \'video\' || type === \'file\') {\n        return null;'),
        'buildThreadMessageFromRealtimePayload must not drop image, video, file, or reply messages'
    );
    assert.ok(
        content.includes('buildMessageAttachmentAccessUrl'),
        'useMessagesV2Realtime must resolve attachment access URLs directly from Realtime payload'
    );
    assert.ok(
        content.includes('metadata.attachments'),
        'buildThreadMessageFromRealtimePayload must unpack metadata.attachments'
    );
});

test('useMessageComposerAttachments: stages attachments on Frame 0 and exports waitForAllUploads', () => {
    const filePath = path.join(process.cwd(), 'src/components/chat/v2/useMessageComposerAttachments.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Ensure Frame 0 immediate staging
    assert.ok(
        content.includes('stagePreparedAttachments(initialPrepared, reservedCount, epoch)'),
        'useMessageComposerAttachments must stage initial items immediately on Frame 0'
    );
    assert.ok(
        content.includes('waitForAllUploads'),
        'useMessageComposerAttachments must export waitForAllUploads'
    );
});

test('useMessageComposerActions: handleSend smoothly awaits in-flight uploads without blocking toast', () => {
    const filePath = path.join(process.cwd(), 'src/components/chat/v2/useMessageComposerActions.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Ensure blocking toast is replaced with graceful in-flight upload awaiting
    assert.ok(
        !content.includes('toast.info(\'Please wait for attachments to finish uploading\')'),
        'handleSend must not abort with a blocking toast when attachments are still uploading'
    );
    assert.ok(
        content.includes('waitForAllUploads'),
        'handleSend must use waitForAllUploads to send smoothly once in-flight uploads complete'
    );
});

test('MessageComposerV2: send button resets loading state immediately and does not spin on empty draft', () => {
    const composerPath = path.join(process.cwd(), 'src/components/chat/v2/MessageComposerV2.tsx');
    const composerContent = fs.readFileSync(composerPath, 'utf8');

    assert.ok(
        composerContent.includes('hasUploadingAttachments || (isSending && (hasSendableContent || hasUploadingAttachments))'),
        'MessageComposerV2 must only show Loader2 when there is pending upload or sendable content'
    );

    const actionsPath = path.join(process.cwd(), 'src/components/chat/v2/useMessageComposerActions.ts');
    const actionsContent = fs.readFileSync(actionsPath, 'utf8');

    assert.ok(
        !actionsContent.includes('setIsSending(true);\n        setSendAnimating(true);'),
        'beginSendAnimation must not lock isSending to true during visual animation'
    );
    assert.ok(
        actionsContent.includes('beginSendAnimation();\n        setIsSending(false);'),
        'handleSend must reset isSending immediately once message is queued in outbox'
    );
});
