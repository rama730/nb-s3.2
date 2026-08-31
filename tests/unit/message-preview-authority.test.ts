import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildConversationLastMessageSnapshot,
    buildConversationParticipantPreview,
    shouldReplaceConversationLastMessage,
} from '@/lib/messages/preview-authority';
import { formatConversationPreview, shouldShowConversationReactionPreview } from '@/lib/messages/preview';

test('buildConversationParticipantPreview derives structured previews canonically', () => {
    const preview = buildConversationParticipantPreview({
        id: 'message-1',
        content: null,
        type: 'system',
        senderId: 'user-1',
        createdAt: '2026-04-07T10:00:00.000Z',
        metadata: {
            structured: {
                kind: 'project_invite',
                version: 1,
                layout: 'minimal_card',
                title: 'Project invite',
                summary: 'Join Alpha Project',
                contextChips: [],
                entityRefs: {},
                stateSnapshot: { status: 'pending', label: 'Pending' },
            },
        },
    });

    assert.deepEqual(preview, {
        lastMessageAt: new Date('2026-04-07T10:00:00.000Z'),
        lastMessageId: 'message-1',
        lastMessagePreview: 'Join Alpha Project',
        lastMessageType: 'project_invite',
        lastMessageSenderId: 'user-1',
    });
});

test('buildConversationLastMessageSnapshot normalizes a thread preview snapshot', () => {
    const snapshot = buildConversationLastMessageSnapshot({
        id: 'message-2',
        content: 'Hey there',
        type: 'text',
        senderId: 'user-2',
        createdAt: '2026-04-07T10:02:00.000Z',
        metadata: {
            deliveryState: 'read',
            deliveryCounts: { total: 1, delivered: 1, read: 1 },
        },
    });

    assert.equal(snapshot?.id, 'message-2');
    assert.equal(snapshot?.content, 'Hey there');
    assert.equal(snapshot?.senderId, 'user-2');
    assert.equal(snapshot?.type, 'text');
    assert.equal(snapshot?.createdAt.toISOString(), '2026-04-07T10:02:00.000Z');
    assert.deepEqual(snapshot?.metadata, {
        deliveryState: 'read',
        deliveryCounts: { total: 1, delivered: 1, read: 1 },
    });
});

test('shouldReplaceConversationLastMessage preserves chronological authority', () => {
    const current = buildConversationLastMessageSnapshot({
        id: 'message-2',
        content: 'Current',
        type: 'text',
        senderId: 'user-2',
        createdAt: '2026-04-07T10:02:00.000Z',
        metadata: null,
    });

    assert.equal(shouldReplaceConversationLastMessage(current, {
        id: 'message-1',
        content: 'Older',
        type: 'text',
        senderId: 'user-1',
        createdAt: '2026-04-07T10:01:00.000Z',
        metadata: null,
    }), false);

    assert.equal(shouldReplaceConversationLastMessage(current, {
        id: 'message-3',
        content: 'Newer',
        type: 'text',
        senderId: 'user-3',
        createdAt: '2026-04-07T10:03:00.000Z',
        metadata: null,
    }), true);
});

test('conversation previews describe media, replies, and deleted messages without retaining content', () => {
    assert.equal(formatConversationPreview({ content: 'Photo', type: 'image', senderId: 'me' }, 'me'), 'You sent a photo');
    assert.equal(formatConversationPreview({ content: '↩ Voice message', type: 'voice', senderId: 'them' }, 'me'), '↩ Replied with a voice message');
    assert.equal(formatConversationPreview({
        content: 'do not retain this',
        type: 'text',
        senderId: 'them',
        deletedAt: '2026-04-07T10:04:00.000Z',
    }, 'me'), 'This message was deleted');
});

test('conversation previews identify project invitations for both participants', () => {
    const invitation = {
        content: 'Invitation to join Gstack as Guide',
        type: 'project_invite',
        senderId: 'me',
    };

    assert.equal(
        formatConversationPreview(invitation, 'me'),
        'You sent a project invitation to Gstack',
    );
    assert.equal(
        formatConversationPreview(invitation, 'them'),
        'You received a project invitation to Gstack',
    );
});

test('a newer reaction is a separate inbox activity preview without replacing message chronology', () => {
    const lastMessage = {
        content: 'The original message',
        type: 'text',
        senderId: 'me',
        createdAt: '2026-04-07T10:00:00.000Z',
    };
    const reaction = {
        messageId: 'message-1',
        actorUserId: 'them',
        emoji: '👍',
        createdAt: '2026-04-07T10:01:00.000Z',
    };

    assert.equal(shouldShowConversationReactionPreview(lastMessage, reaction), true);
    assert.equal(formatConversationPreview(lastMessage, 'me', reaction, 'Rama'), 'Rama reacted 👍 to your message');
    assert.equal(shouldShowConversationReactionPreview(lastMessage, {
        ...reaction,
        createdAt: '2026-04-07T09:59:00.000Z',
    }), false);
});
