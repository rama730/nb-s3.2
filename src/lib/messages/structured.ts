export const STRUCTURED_MESSAGE_KINDS = [
    'project_invite',
    'feedback_request',
    'availability_request',
    'task_approval',
    'rate_share',
    'handoff_summary',
    'activity_bridge',
] as const;

export type StructuredMessageKind = (typeof STRUCTURED_MESSAGE_KINDS)[number];

export const MESSAGE_CONTEXT_CHIP_KINDS = ['project', 'task', 'file', 'profile'] as const;
export type MessageContextChipKind = (typeof MESSAGE_CONTEXT_CHIP_KINDS)[number];

export const MESSAGE_WORKFLOW_ITEM_KINDS = [
    'project_invite',
    'feedback_request',
    'availability_request',
    'task_approval',
    'follow_up',
] as const;
export type MessageWorkflowItemKind = (typeof MESSAGE_WORKFLOW_ITEM_KINDS)[number];

export const MESSAGE_WORKFLOW_ITEM_STATUSES = [
    'pending',
    'accepted',
    'declined',
    'completed',
    'needs_changes',
    'canceled',
    'expired',
] as const;
export type MessageWorkflowItemStatus = (typeof MESSAGE_WORKFLOW_ITEM_STATUSES)[number];

export const MESSAGE_WORKFLOW_ITEM_SCOPES = ['conversation', 'private'] as const;
export type MessageWorkflowItemScope = (typeof MESSAGE_WORKFLOW_ITEM_SCOPES)[number];

export const STRUCTURED_WORKFLOW_RESOLUTION_ACTIONS = [
    'accept',
    'decline',
    'complete',
    'needs_changes',
    'available',
    'busy',
    'offline',
    'focusing',
] as const;
export type WorkflowResolutionAction = (typeof STRUCTURED_WORKFLOW_RESOLUTION_ACTIONS)[number];

export type StructuredWorkflowActorRole = 'creator' | 'assignee' | 'viewer';

export interface StructuredWorkflowActionDescriptor {
    action: WorkflowResolutionAction;
    label: string;
    tone: 'primary' | 'secondary';
}

export interface StructuredWorkflowTransition {
    nextStatus: MessageWorkflowItemStatus;
    nextLabel: string;
    bridge: { title: string; summary: string } | null;
}

export interface MessageContextChip {
    kind: MessageContextChipKind;
    id: string;
    label: string;
    subtitle?: string | null;
}

export interface StructuredMessageEntityRefs {
    projectId?: string | null;
    taskId?: string | null;
    fileId?: string | null;
    profileId?: string | null;
    messageId?: string | null;
    applicationId?: string | null;
}

export interface StructuredMessageStateSnapshot {
    status: MessageWorkflowItemStatus | 'shared';
    label: string;
    note?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    resolvedAt?: string | null;
}

export interface StructuredMessagePayload {
    kind: StructuredMessageKind;
    version: number;
    layout: 'minimal_card';
    title: string;
    summary: string;
    contextChips: MessageContextChip[];
    workflowItemId?: string | null;
    stateSnapshot?: StructuredMessageStateSnapshot | null;
    entityRefs: StructuredMessageEntityRefs;
    payload?: Record<string, unknown> | null;
}

export interface PrivateFollowUpSnapshot {
    workflowItemId: string;
    status: MessageWorkflowItemStatus;
    note?: string | null;
    dueAt?: string | null;
    preview?: string | null;
}

const MAX_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 240;
const MAX_CHIP_LABEL_LENGTH = 64;
const MAX_CHIP_SUBTITLE_LENGTH = 80;

const STRUCTURED_WORKFLOW_ACTIONS: Record<
    MessageWorkflowItemKind,
    StructuredWorkflowActionDescriptor[]
> = {
    project_invite: [
        { action: 'accept', label: 'Accept', tone: 'primary' },
        { action: 'decline', label: 'Decline', tone: 'secondary' },
    ],
    feedback_request: [
        { action: 'complete', label: 'Mark complete', tone: 'primary' },
    ],
    availability_request: [
        { action: 'available', label: 'Available', tone: 'secondary' },
        { action: 'busy', label: 'Busy', tone: 'secondary' },
        { action: 'focusing', label: 'Focusing', tone: 'secondary' },
        { action: 'offline', label: 'Offline', tone: 'secondary' },
    ],
    task_approval: [
        { action: 'accept', label: 'Approve', tone: 'primary' },
        { action: 'needs_changes', label: 'Request changes', tone: 'secondary' },
    ],
    follow_up: [],
};

const STRUCTURED_WORKFLOW_TRANSITIONS: Record<
    MessageWorkflowItemKind,
    Partial<Record<WorkflowResolutionAction, StructuredWorkflowTransition>>
> = {
    project_invite: {
        accept: {
            nextStatus: 'accepted',
            nextLabel: 'Accepted',
            bridge: { title: 'Invite accepted', summary: 'Project invite accepted' },
        },
        decline: {
            nextStatus: 'declined',
            nextLabel: 'Declined',
            bridge: { title: 'Invite declined', summary: 'Project invite declined' },
        },
    },
    feedback_request: {
        complete: {
            nextStatus: 'completed',
            nextLabel: 'Completed',
            bridge: { title: 'Feedback request completed', summary: 'Feedback request completed' },
        },
    },
    availability_request: {
        available: { nextStatus: 'completed', nextLabel: 'Available', bridge: null },
        busy: { nextStatus: 'completed', nextLabel: 'Busy', bridge: null },
        offline: { nextStatus: 'completed', nextLabel: 'Offline', bridge: null },
        focusing: { nextStatus: 'completed', nextLabel: 'Focusing', bridge: null },
    },
    task_approval: {
        accept: {
            nextStatus: 'accepted',
            nextLabel: 'Approved',
            bridge: { title: 'Task approved', summary: 'Task approval approved' },
        },
        needs_changes: {
            nextStatus: 'needs_changes',
            nextLabel: 'Needs changes',
            bridge: { title: 'Task changes requested', summary: 'Task approval needs changes' },
        },
    },
    follow_up: {},
};

function clampText(value: string, maxLength: number) {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function isStructuredMessageKind(value: unknown): value is StructuredMessageKind {
    return typeof value === 'string' && STRUCTURED_MESSAGE_KINDS.includes(value as StructuredMessageKind);
}

export function isMessageContextChipKind(value: unknown): value is MessageContextChipKind {
    return typeof value === 'string' && MESSAGE_CONTEXT_CHIP_KINDS.includes(value as MessageContextChipKind);
}

export function isMessageWorkflowItemKind(value: unknown): value is MessageWorkflowItemKind {
    return typeof value === 'string' && MESSAGE_WORKFLOW_ITEM_KINDS.includes(value as MessageWorkflowItemKind);
}

export function isMessageWorkflowItemStatus(value: unknown): value is MessageWorkflowItemStatus {
    return typeof value === 'string' && MESSAGE_WORKFLOW_ITEM_STATUSES.includes(value as MessageWorkflowItemStatus);
}

export function isWorkflowResolutionAction(value: unknown): value is WorkflowResolutionAction {
    return typeof value === 'string' && STRUCTURED_WORKFLOW_RESOLUTION_ACTIONS.includes(value as WorkflowResolutionAction);
}

export function normalizeMessageContextChips(value: unknown): MessageContextChip[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((item) => {
        if (!item || typeof item !== 'object') {
            return [];
        }

        const raw = item as Partial<MessageContextChip>;
        if (!isMessageContextChipKind(raw.kind) || typeof raw.id !== 'string' || raw.id.trim().length === 0) {
            return [];
        }

        const label = typeof raw.label === 'string' ? clampText(raw.label, MAX_CHIP_LABEL_LENGTH) : '';
        if (!label) {
            return [];
        }

        return [{
            kind: raw.kind,
            id: raw.id.trim(),
            label,
            subtitle: typeof raw.subtitle === 'string'
                ? clampText(raw.subtitle, MAX_CHIP_SUBTITLE_LENGTH)
                : null,
        }];
    });
}

export function normalizeStructuredStateSnapshot(value: unknown): StructuredMessageStateSnapshot | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const raw = value as Partial<StructuredMessageStateSnapshot>;
    const status = raw.status;
    const label = typeof raw.label === 'string' ? clampText(raw.label, 48) : '';
    if (!(status === 'shared' || isMessageWorkflowItemStatus(status)) || !label) {
        return null;
    }

    return {
        status,
        label,
        note: typeof raw.note === 'string' ? clampText(raw.note, 160) : null,
        actorId: typeof raw.actorId === 'string' && raw.actorId.trim() ? raw.actorId.trim() : null,
        actorName: typeof raw.actorName === 'string' ? clampText(raw.actorName, 64) : null,
        resolvedAt: typeof raw.resolvedAt === 'string' && raw.resolvedAt.trim() ? raw.resolvedAt.trim() : null,
    };
}

export function createPendingStructuredState(label: string = 'Pending'): StructuredMessageStateSnapshot {
    return {
        status: 'pending',
        label: clampText(label, 48) || 'Pending',
    };
}

export function getStructuredWorkflowActorRole(params: {
    currentUserId?: string | null;
    creatorId?: string | null;
    assigneeUserId?: string | null;
}): StructuredWorkflowActorRole {
    const currentUserId = params.currentUserId?.trim() || null;
    const assigneeUserId = params.assigneeUserId?.trim() || null;
    const creatorId = params.creatorId?.trim() || null;
    if (!currentUserId) {
        return 'viewer';
    }
    if (assigneeUserId && assigneeUserId === currentUserId) {
        return 'assignee';
    }
    if (creatorId && creatorId === currentUserId) {
        return 'creator';
    }
    return 'viewer';
}

export function isPendingWorkflowStatus(status: MessageWorkflowItemStatus | null | undefined): boolean {
    return status === 'pending';
}

export function getStructuredWorkflowActionDescriptors(params: {
    kind: StructuredMessageKind | MessageWorkflowItemKind;
    currentUserId?: string | null;
    creatorId?: string | null;
    assigneeUserId?: string | null;
    status?: MessageWorkflowItemStatus | null;
}): StructuredWorkflowActionDescriptor[] {
    if (!isMessageWorkflowItemKind(params.kind)) {
        return [];
    }
    if (!isPendingWorkflowStatus(params.status ?? 'pending')) {
        return [];
    }
    const actorRole = getStructuredWorkflowActorRole(params);
    if (actorRole !== 'assignee') {
        return [];
    }
    return STRUCTURED_WORKFLOW_ACTIONS[params.kind];
}

export function resolveStructuredWorkflowTransition(params: {
    kind: MessageWorkflowItemKind;
    currentStatus: MessageWorkflowItemStatus | null | undefined;
    action: WorkflowResolutionAction;
    currentUserId?: string | null;
    creatorId?: string | null;
    assigneeUserId?: string | null;
}): StructuredWorkflowTransition | null {
    if (!isPendingWorkflowStatus(params.currentStatus)) {
        return null;
    }
    const actorRole = getStructuredWorkflowActorRole(params);
    if (actorRole !== 'assignee') {
        return null;
    }
    return STRUCTURED_WORKFLOW_TRANSITIONS[params.kind][params.action] ?? null;
}

function normalizeStructuredEntityRefs(value: unknown): StructuredMessageEntityRefs {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const raw = value as StructuredMessageEntityRefs;
    return {
        projectId: typeof raw.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : null,
        taskId: typeof raw.taskId === 'string' && raw.taskId.trim() ? raw.taskId.trim() : null,
        fileId: typeof raw.fileId === 'string' && raw.fileId.trim() ? raw.fileId.trim() : null,
        profileId: typeof raw.profileId === 'string' && raw.profileId.trim() ? raw.profileId.trim() : null,
        messageId: typeof raw.messageId === 'string' && raw.messageId.trim() ? raw.messageId.trim() : null,
        applicationId: typeof raw.applicationId === 'string' && raw.applicationId.trim() ? raw.applicationId.trim() : null,
    };
}

export function normalizeStructuredMessagePayload(value: unknown): StructuredMessagePayload | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const raw = value as Partial<StructuredMessagePayload>;
    if (!isStructuredMessageKind(raw.kind)) {
        return null;
    }

    const title = typeof raw.title === 'string' ? clampText(raw.title, MAX_TITLE_LENGTH) : '';
    const summary = typeof raw.summary === 'string' ? clampText(raw.summary, MAX_SUMMARY_LENGTH) : '';
    if (!title || !summary) {
        return null;
    }

    return {
        kind: raw.kind,
        version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1,
        layout: 'minimal_card',
        title,
        summary,
        contextChips: normalizeMessageContextChips(raw.contextChips),
        workflowItemId: typeof raw.workflowItemId === 'string' && raw.workflowItemId.trim()
            ? raw.workflowItemId.trim()
            : null,
        stateSnapshot: normalizeStructuredStateSnapshot(raw.stateSnapshot),
        entityRefs: normalizeStructuredEntityRefs(raw.entityRefs),
        payload: raw.payload && typeof raw.payload === 'object'
            ? raw.payload as Record<string, unknown>
            : null,
    };
}

export function createStructuredMessagePayload(input: {
    kind: StructuredMessageKind;
    title: string;
    summary: string;
    contextChips?: MessageContextChip[];
    workflowItemId?: string | null;
    stateSnapshot?: StructuredMessagePayload['stateSnapshot'];
    entityRefs?: StructuredMessagePayload['entityRefs'];
    payload?: Record<string, unknown> | null;
    version?: number;
}): StructuredMessagePayload | null {
    const title = clampText(input.title, MAX_TITLE_LENGTH);
    const summary = clampText(input.summary, MAX_SUMMARY_LENGTH);
    if (!title || !summary) {
        return null;
    }

    return {
        kind: input.kind,
        version: input.version ?? 1,
        layout: 'minimal_card',
        title,
        summary,
        contextChips: normalizeMessageContextChips(input.contextChips),
        workflowItemId: input.workflowItemId ?? null,
        stateSnapshot: normalizeStructuredStateSnapshot(input.stateSnapshot),
        entityRefs: normalizeStructuredEntityRefs(input.entityRefs),
        payload: input.payload && typeof input.payload === 'object'
            ? input.payload
            : null,
    };
}

export function getStructuredMessageKindLabel(kind: StructuredMessageKind): string {
    switch (kind) {
        case 'project_invite':
            return 'Project invite';
        case 'feedback_request':
            return 'Feedback request';
        case 'availability_request':
            return 'Availability check';
        case 'task_approval':
            return 'Task approval';
        case 'rate_share':
            return 'Rate';
        case 'handoff_summary':
            return 'Handoff';
        case 'activity_bridge':
            return 'Update';
        default:
            return 'Update';
    }
}

export function getStructuredMessagePreview(payload: StructuredMessagePayload): string {
    const base = clampText(payload.summary || payload.title || getStructuredMessageKindLabel(payload.kind), 160);
    const stateLabel = getStructuredStateLabel(payload.stateSnapshot);
    if (!stateLabel || stateLabel.toLowerCase() === 'pending') {
        return base;
    }
    return clampText(`${base} (${stateLabel})`, 160);
}

export function getMessagePreviewText(params: {
    content?: string | null;
    type?: string | null;
    metadata?: Record<string, unknown> | null;
}): string {
    const structured = getStructuredMessageFromMetadata(params.metadata);
    if (structured) {
        return getStructuredMessagePreview(structured);
    }

    if (typeof params.content === 'string' && params.content.trim().length > 0) {
        const normalized = params.content.replace(/\s+/g, ' ').trim();
        if (normalized.includes('```')) return 'Code snippet';
        return clampText(normalized, 160);
    }

    switch (params.type) {
        case 'image':
            return 'Photo';
        case 'video':
            return 'Video';
        case 'file':
            return 'Attachment';
        case 'system':
            return 'System update';
        default:
            return 'Message';
    }
}

export function getStructuredMessageSearchKind(rawValue: string): StructuredMessageKind | null {
    switch (rawValue.trim().toLowerCase()) {
        case 'invite':
        case 'project-invite':
        case 'project_invite':
            return 'project_invite';
        case 'feedback':
        case 'feedback_request':
        case 'feedback-request':
            return 'feedback_request';
        case 'availability':
        case 'availability_request':
        case 'availability-request':
            return 'availability_request';
        case 'approval':
        case 'task_approval':
        case 'task-approval':
            return 'task_approval';
        case 'rate':
        case 'rate_share':
        case 'rate-share':
            return 'rate_share';
        case 'handoff':
        case 'handoff_summary':
        case 'handoff-summary':
            return 'handoff_summary';
        case 'bridge':
        case 'activity':
        case 'activity_bridge':
        case 'activity-bridge':
            return 'activity_bridge';
        default:
            return null;
    }
}

export function withStructuredMessageMetadata(
    metadata: Record<string, unknown> | null | undefined,
    structured: StructuredMessagePayload | null,
): Record<string, unknown> {
    const nextMetadata = {
        ...(metadata || {}),
    };

    if (!structured) {
        delete nextMetadata.structured;
        return nextMetadata;
    }

    nextMetadata.structured = structured;
    return nextMetadata;
}

export function withMessageContextChipsMetadata(
    metadata: Record<string, unknown> | null | undefined,
    contextChips: MessageContextChip[] | null | undefined,
): Record<string, unknown> {
    const nextMetadata = {
        ...(metadata || {}),
    };
    const normalized = normalizeMessageContextChips(contextChips);
    if (normalized.length === 0) {
        delete nextMetadata.contextChips;
        return nextMetadata;
    }
    nextMetadata.contextChips = normalized;
    return nextMetadata;
}

export function getMessageContextChipsFromMetadata(metadata: unknown): MessageContextChip[] {
    if (!metadata || typeof metadata !== 'object') {
        return [];
    }

    const structured = getStructuredMessageFromMetadata(metadata);
    if (structured) {
        return structured.contextChips;
    }

    return normalizeMessageContextChips((metadata as Record<string, unknown>).contextChips);
}

export function withPrivateFollowUpMetadata(
    metadata: Record<string, unknown> | null | undefined,
    followUp: PrivateFollowUpSnapshot | null,
): Record<string, unknown> {
    const nextMetadata = {
        ...(metadata || {}),
    };

    if (!followUp) {
        delete nextMetadata.privateFollowUp;
        return nextMetadata;
    }

    nextMetadata.privateFollowUp = {
        workflowItemId: followUp.workflowItemId,
        status: followUp.status,
        note: followUp.note ?? null,
        dueAt: followUp.dueAt ?? null,
        preview: followUp.preview ?? null,
    } satisfies PrivateFollowUpSnapshot;

    return nextMetadata;
}

export function getPrivateFollowUpFromMetadata(metadata: unknown): PrivateFollowUpSnapshot | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const raw = (metadata as Record<string, unknown>).privateFollowUp;
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const value = raw as Partial<PrivateFollowUpSnapshot>;
    if (
        typeof value.workflowItemId !== 'string'
        || value.workflowItemId.trim().length === 0
        || !isMessageWorkflowItemStatus(value.status)
    ) {
        return null;
    }

    return {
        workflowItemId: value.workflowItemId.trim(),
        status: value.status,
        note: typeof value.note === 'string' ? clampText(value.note, 160) : null,
        dueAt: typeof value.dueAt === 'string' && value.dueAt.trim() ? value.dueAt.trim() : null,
        preview: typeof value.preview === 'string' ? clampText(value.preview, 160) : null,
    };
}

export function getStructuredMessageFromMetadata(metadata: unknown): StructuredMessagePayload | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }
    return normalizeStructuredMessagePayload((metadata as Record<string, unknown>).structured);
}

export function getStructuredStateLabel(
    snapshot: StructuredMessageStateSnapshot | null | undefined,
): string | null {
    if (!snapshot?.label) {
        return null;
    }
    return clampText(snapshot.label, 48);
}
