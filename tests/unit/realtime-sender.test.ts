import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildViewerSenderIdentity,
    resolveRealtimeMessageSender,
} from '@/lib/messages/realtime-sender';

test('buildViewerSenderIdentity maps viewer metadata to sender identity', () => {
    assert.deepEqual(
        buildViewerSenderIdentity({
            id: 'viewer-1',
            user_metadata: {
                username: 'ch_rama',
                full_name: 'CH Rama',
                avatar_url: 'https://example.com/avatar.png',
            },
        }),
        {
            id: 'viewer-1',
            username: 'ch_rama',
            fullName: 'CH Rama',
            avatarUrl: 'https://example.com/avatar.png',
        },
    );
});

test('resolveRealtimeMessageSender prefers the viewer identity for self-authored messages', () => {
    const viewerIdentity = buildViewerSenderIdentity({
        id: 'viewer-1',
        user_metadata: {
            username: 'ch_rama',
            full_name: 'CH Rama',
            avatar_url: 'https://example.com/viewer.png',
        },
    });

    assert.deepEqual(
        resolveRealtimeMessageSender({
            senderId: 'viewer-1',
            viewerIdentity,
            participants: [
                {
                    id: 'peer-1',
                    username: 'peer',
                    fullName: 'Peer User',
                    avatarUrl: 'https://example.com/peer.png',
                },
            ],
            messages: [],
        }),
        viewerIdentity,
    );
});

test('resolveRealtimeMessageSender reuses cached sender identities for incoming messages', () => {
    assert.deepEqual(
        resolveRealtimeMessageSender({
            senderId: 'peer-1',
            viewerIdentity: null,
            participants: [
                {
                    id: 'peer-1',
                    username: 'peer',
                    fullName: 'Peer User',
                    avatarUrl: 'https://example.com/participant.png',
                },
            ],
            messages: [
                {
                    senderId: 'peer-1',
                    sender: {
                        id: 'peer-1',
                        username: 'peer',
                        fullName: 'Peer User',
                        avatarUrl: 'https://example.com/from-message.png',
                    },
                },
            ],
        }),
        {
            id: 'peer-1',
            username: 'peer',
            fullName: 'Peer User',
            avatarUrl: 'https://example.com/from-message.png',
        },
    );
});

test('resolveRealtimeMessageSender falls back to conversation participants when no cached sender exists', () => {
    assert.deepEqual(
        resolveRealtimeMessageSender({
            senderId: 'peer-1',
            viewerIdentity: null,
            participants: [
                {
                    id: 'peer-1',
                    username: 'peer',
                    fullName: 'Peer User',
                    avatarUrl: 'https://example.com/participant.png',
                },
            ],
            messages: [],
        }),
        {
            id: 'peer-1',
            username: 'peer',
            fullName: 'Peer User',
            avatarUrl: 'https://example.com/participant.png',
        },
    );
});
