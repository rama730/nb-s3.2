import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pixelsHaveTransparency } from '@/lib/messages/image-compression';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('historical message videos wait for explicit viewer intent', () => {
    const attachments = readProjectFile('src/components/chat/v2/message-attachments.tsx');

    assert.doesNotMatch(attachments, /IntersectionObserver/);
    assert.doesNotMatch(attachments, /loop=\{true\}/);
    assert.doesNotMatch(attachments, /video\.play\(/);
    assert.match(attachments, /The selected viewer owns the first video-body request and playback/);
    assert.match(attachments, /: attachment\.thumbnailUrl;/);
});

test('media viewer loads one selected full asset without hidden adjacent bodies', () => {
    const viewer = readProjectFile('src/components/ui/media-viewer.tsx');

    assert.doesNotMatch(viewer, /Hidden adjacent media preloaders/);
    assert.doesNotMatch(viewer, /prevAttachment|nextAttachment/);
    assert.doesNotMatch(viewer, /att\.localUrl \|\| att\.thumbnailUrl \|\| att\.url/);
    assert.match(viewer, /url=\{currentAttachment\.localUrl \|\| currentAttachment\.url\}/);
    assert.match(viewer, /elementRef=\{viewerVideoRef\}/);
});

test('conversation rows do not fetch full threads on pointer hover', () => {
    const list = readProjectFile('src/components/chat/v2/ConversationListV2.tsx');
    const workspace = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');

    assert.doesNotMatch(list, /onMouseEnter|onPrefetchConversation|prefetchTimerRef/);
    assert.doesNotMatch(workspace, /handlePrefetchConversation|prefetchInfiniteQuery/);
});

test('PNG alpha detection preserves transparency while allowing opaque conversion', () => {
    const compression = readProjectFile('src/lib/messages/image-compression.ts');

    assert.equal(pixelsHaveTransparency(new Uint8ClampedArray([1, 2, 3, 255])), false);
    assert.equal(pixelsHaveTransparency(new Uint8ClampedArray([1, 2, 3, 254])), true);
    assert.match(compression, /file\.type === 'image\/png' && !transparentPng\s*\? 'image\/webp'/);
    assert.match(compression, /transparentPng[\s\S]*: file\.type === 'image\/png' \? 'image\/png'/);
    assert.equal((compression.match(/finally \{/g) ?? []).length, 2);
    assert.equal((compression.match(/bitmap\?\.close\(\)/g) ?? []).length, 2);
});
