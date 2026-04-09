import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPendingStructuredState,
    createStructuredMessagePayload,
    getMessageContextChipsFromMetadata,
    getMessagePreviewText,
    getStructuredWorkflowActionDescriptors,
    type MessageContextChip,
    getPrivateFollowUpFromMetadata,
    normalizeStructuredMessagePayload,
    resolveStructuredWorkflowTransition,
    withMessageContextChipsMetadata,
    withPrivateFollowUpMetadata,
    withStructuredMessageMetadata,
} from '@/lib/messages/structured';

test('normalizeStructuredMessagePayload enforces a canonical minimal-card contract', () => {
    const payload = normalizeStructuredMessagePayload({
        kind: 'feedback_request',
        version: 2,
        title: '   Feedback request   ',
        summary: '  Please review the current project landing page copy. ',
        contextChips: [
            { kind: 'project', id: 'project-1', label: ' Alpha Project ', subtitle: ' /alpha ' },
            { kind: 'task', id: '', label: 'Ignored' },
        ],
        stateSnapshot: createPendingStructuredState(),
        entityRefs: { projectId: 'project-1' },
    });

    assert.deepEqual(payload, {
        kind: 'feedback_request',
        version: 2,
        layout: 'minimal_card',
        title: 'Feedback request',
        summary: 'Please review the current project landing page copy.',
        contextChips: [{
            kind: 'project',
            id: 'project-1',
            label: 'Alpha Project',
            subtitle: '/alpha',
        }],
        workflowItemId: null,
        stateSnapshot: {
            status: 'pending',
            label: 'Pending',
            note: null,
            actorId: null,
            actorName: null,
            resolvedAt: null,
        },
        entityRefs: { projectId: 'project-1', taskId: null, fileId: null, profileId: null, messageId: null, applicationId: null },
        payload: null,
    });
});

test('createStructuredMessagePayload rejects empty title or summary after clamping', () => {
    assert.equal(createStructuredMessagePayload({
        kind: 'feedback_request',
        title: '   ',
        summary: 'Valid summary',
    }), null);

    assert.equal(createStructuredMessagePayload({
        kind: 'feedback_request',
        title: 'Valid title',
        summary: '   ',
    }), null);
});

test('message metadata helpers preserve structured previews, chips, and private follow-ups', () => {
    const contextChips: MessageContextChip[] = [
        { kind: 'project', id: 'project-1', label: 'Alpha Project', subtitle: null },
        { kind: 'file', id: 'file-1', label: 'brief.pdf', subtitle: 'docs/brief.pdf' },
    ];

    const structured = createStructuredMessagePayload({
        kind: 'rate_share',
        title: 'Rate',
        summary: '40 USD / hour',
        stateSnapshot: { status: 'shared', label: 'Shared' },
        contextChips,
    });
    assert.ok(structured);

    const metadataWithStructured = withStructuredMessageMetadata({}, structured);
    const metadataWithChips = withMessageContextChipsMetadata(metadataWithStructured, contextChips);
    const metadataWithFollowUp = withPrivateFollowUpMetadata(metadataWithChips, {
        workflowItemId: 'workflow-1',
        status: 'pending',
        note: 'Review tomorrow morning',
        dueAt: '2026-04-08T10:00:00.000Z',
        preview: '40 USD / hour',
    });

    assert.equal(
        getMessagePreviewText({
            content: null,
            type: 'text',
            metadata: metadataWithStructured,
        }),
        '40 USD / hour (Shared)',
    );
    assert.deepEqual(getMessageContextChipsFromMetadata(metadataWithChips), contextChips);
    assert.deepEqual(getPrivateFollowUpFromMetadata(metadataWithFollowUp), {
        workflowItemId: 'workflow-1',
        status: 'pending',
        note: 'Review tomorrow morning',
        dueAt: '2026-04-08T10:00:00.000Z',
        preview: '40 USD / hour',
    });
});

test('workflow actions are only exposed to the assignee while pending', () => {
    const actions = getStructuredWorkflowActionDescriptors({
        kind: 'task_approval',
        currentUserId: 'user-assignee',
        creatorId: 'user-creator',
        assigneeUserId: 'user-assignee',
        status: 'pending',
    });
    assert.deepEqual(actions, [
        { action: 'accept', label: 'Approve', tone: 'primary' },
        { action: 'needs_changes', label: 'Request changes', tone: 'secondary' },
    ]);

    assert.deepEqual(getStructuredWorkflowActionDescriptors({
        kind: 'task_approval',
        currentUserId: 'user-creator',
        creatorId: 'user-creator',
        assigneeUserId: 'user-assignee',
        status: 'pending',
    }), []);

    assert.deepEqual(getStructuredWorkflowActionDescriptors({
        kind: 'task_approval',
        currentUserId: 'user-assignee',
        creatorId: 'user-creator',
        assigneeUserId: 'user-assignee',
        status: 'accepted',
    }), []);
});

test('workflow transitions stay aligned with workflow kind semantics', () => {
    assert.deepEqual(resolveStructuredWorkflowTransition({
        kind: 'task_approval',
        currentStatus: 'pending',
        action: 'accept',
        currentUserId: 'user-assignee',
        creatorId: 'user-creator',
        assigneeUserId: 'user-assignee',
    }), {
        nextStatus: 'accepted',
        nextLabel: 'Approved',
        bridge: { title: 'Task approved', summary: 'Task approval approved' },
    });

    assert.equal(resolveStructuredWorkflowTransition({
        kind: 'task_approval',
        currentStatus: 'pending',
        action: 'decline',
        currentUserId: 'user-assignee',
        creatorId: 'user-creator',
        assigneeUserId: 'user-assignee',
    }), null);

    assert.equal(resolveStructuredWorkflowTransition({
        kind: 'project_invite',
        currentStatus: 'accepted',
        action: 'accept',
        currentUserId: 'user-assignee',
        creatorId: 'user-creator',
        assigneeUserId: 'user-assignee',
    }), null);
});

test('workflow action descriptors stay in parity with resolvable transitions', () => {
    const actionableKinds = [
        'project_invite',
        'feedback_request',
        'availability_request',
        'task_approval',
    ] as const;

    for (const kind of actionableKinds) {
        const descriptors = getStructuredWorkflowActionDescriptors({
            kind,
            currentUserId: 'user-assignee',
            creatorId: 'user-creator',
            assigneeUserId: 'user-assignee',
            status: 'pending',
        });

        assert.ok(descriptors.length > 0, `Expected actions for ${kind}`);
        for (const descriptor of descriptors) {
            const transition = resolveStructuredWorkflowTransition({
                kind,
                currentStatus: 'pending',
                action: descriptor.action,
                currentUserId: 'user-assignee',
                creatorId: 'user-creator',
                assigneeUserId: 'user-assignee',
            });
            assert.ok(transition, `Expected transition for ${kind}:${descriptor.action}`);
        }
    }
});
