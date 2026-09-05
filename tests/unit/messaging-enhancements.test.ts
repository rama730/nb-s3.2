import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { getTypingDisplayName, getTypingStatusText } from '@/lib/chat/typing-display';

test('typing-display: getTypingDisplayName returns user fullName when available', () => {
    const user = { id: 'u1', fullName: 'Alice Smith', username: 'alice' };
    assert.equal(getTypingDisplayName(user), 'Alice Smith');
});

test('typing-display: getTypingDisplayName returns username if fullName is missing', () => {
    const user = { id: 'u2', fullName: null, username: 'bob_dev' };
    assert.equal(getTypingDisplayName(user), 'bob_dev');
});

test('typing-display: getTypingDisplayName trims whitespace and falls back to Someone if empty', () => {
    const emptyUser = { id: 'u3', fullName: '   ', username: ' ' };
    assert.equal(getTypingDisplayName(emptyUser), 'Someone');
});

test('typing-display: getTypingStatusText renders correct single and multi-user strings', () => {
    const user1 = { id: 'u1', fullName: 'Alex Rivera', username: 'alex' };
    const user2 = { id: 'u2', fullName: 'Sam Taylor', username: 'sam' };

    assert.equal(getTypingStatusText([user1], { ellipsis: true }), 'Alex Rivera is typing...');
    assert.equal(getTypingStatusText([user1, user2], { ellipsis: true }), 'Alex Rivera and Sam Taylor are typing...');
    assert.equal(getTypingStatusText([]), null);
});

test('realtime presence-client: preserves incoming payload.profile and populates userName', () => {
    const presenceClientPath = path.join(process.cwd(), 'src/lib/realtime/presence-client.ts');
    const content = fs.readFileSync(presenceClientPath, 'utf8');

    // Verify broadcastTyping payload populates userName and profile
    assert.ok(
        content.includes('userName: event.profile?.fullName ?? event.profile?.username ?? null'),
        'broadcastTyping must populate userName from profile'
    );

    // Verify setupChannel preserves incoming payload.profile instead of overwriting with null
    assert.ok(
        content.includes('const profile = payload.profile ?? authenticatedMember.profile ?? null;'),
        'setupChannel must retain payload.profile'
    );
});

test('video attachments: renders inline video with autoplay, muted, playsInline, and loop', () => {
    const attachmentsPath = path.join(process.cwd(), 'src/components/chat/v2/message-attachments.tsx');
    const content = fs.readFileSync(attachmentsPath, 'utf8');

    assert.ok(content.includes('<video'), 'Must render inline <video> element for video attachments');
    assert.ok(content.includes('autoPlay'), 'Video must have autoPlay attribute');
    assert.ok(content.includes('muted'), 'Video must have muted attribute for browser autoplay policy');
    assert.ok(content.includes('loop'), 'Video must have loop attribute');
    assert.ok(content.includes('playsInline'), 'Video must have playsInline attribute for mobile autoplay');
    assert.ok(content.includes('group-hover/video'), 'Video must show speaker control button on hover');
    assert.ok(content.includes('VolumeX') && content.includes('Volume2'), 'Must include VolumeX and Volume2 toggle icons');
});

test('global presence: MainRuntimeProviders sets presenceEnabled={true}', () => {
    const runtimePath = path.join(process.cwd(), 'src/components/providers/MainRuntimeProviders.tsx');
    const content = fs.readFileSync(runtimePath, 'utf8');

    assert.ok(
        content.includes('<LazyChatProvider presenceEnabled={true} />'),
        'MainRuntimeProviders must pass presenceEnabled={true} so user presence shows green across entire app'
    );
    assert.ok(
        !content.includes('presenceEnabled={isMessagesRoute || popupOpen}'),
        'Must not restrict presence to isMessagesRoute || popupOpen'
    );
});

test('reaction placement: sender side aligns left (opposite corner), receiver side aligns right', () => {
    const bubblePath = path.join(process.cwd(), 'src/components/chat/v2/MessageBubbleV2.tsx');
    const content = fs.readFileSync(bubblePath, 'utf8');

    // In MessageBubbleV2:
    // Sender (isOwn === true) -> align="start" (bottom-left corner of video/bubble)
    // Receiver (isOwn === false) -> align="end" (bottom-right corner of PDF/bubble)
    assert.ok(
        content.includes("align={isOwn ? 'start' : 'end'}"),
        'ReactionPillRow must align start (left) on sender side and end (right) on receiver side'
    );
});
