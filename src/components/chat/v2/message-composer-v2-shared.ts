import type { UploadedAttachment } from '@/app/actions/messaging';
import type { MessageContextChip } from '@/lib/messages/structured';

export type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';
export type ApplicationWorkflowAction = 'accept' | 'reject' | 'withdraw' | 'reopen';
export type StructuredComposerKind =
    | 'project_invite'
    | 'feedback_request'
    | 'availability_request'
    | 'task_approval'
    | 'rate_share'
    | 'handoff_summary';

export interface PendingAttachment {
    id: string;
    file: File;
    preview?: string;
    status: UploadStatus;
    progress: number;
    attempts: number;
    uploaded?: UploadedAttachment;
    error?: string;
}

export const MAX_UPLOAD_RETRIES = 3;

export const STRUCTURED_ACTION_OPTIONS = [
    { kind: 'project_invite', label: 'Send invite to project', description: 'Invite the other participant into a project you manage.' },
    { kind: 'feedback_request', label: 'Request feedback', description: 'Ask for focused feedback on work, a task, or a file.' },
    { kind: 'availability_request', label: 'Confirm availability', description: 'Check whether the other participant is available.' },
    { kind: 'task_approval', label: 'Approve a task', description: 'Request approval or changes for an existing task.' },
    { kind: 'rate_share', label: 'Send a rate', description: 'Share a rate in a compact, professional card.' },
    { kind: 'handoff_summary', label: 'Handoff summary', description: 'Summarize what is done, blocked, and next.' },
] as const satisfies ReadonlyArray<{
    kind: StructuredComposerKind;
    label: string;
    description: string;
}>;

export type StructuredActionOption = (typeof STRUCTURED_ACTION_OPTIONS)[number];

export const GUIDED_FIRST_CONTACT_TEMPLATES = [
    'Hi, I’m reaching out because your project caught my attention. I’d love to contribute and can share relevant experience if helpful.',
    'Hi, I’m interested in collaborating. I can help with the current scope and I’m happy to share examples of similar work.',
    'Hi, I wanted to reach out with a quick introduction and context about why I think I could be a strong fit here.',
] as const;

export type SlashMenuItem =
    | {
        key: string;
        section: 'Actions';
        label: string;
        description: string;
        type: 'action';
        actionKind: StructuredComposerKind;
    }
    | {
        key: string;
        section: 'Context';
        label: string;
        description: string;
        type: 'chip';
        chip: MessageContextChip;
    };

export type StructuredActionDraft = {
    kind: StructuredComposerKind | null;
    title: string;
    summary: string;
    note: string;
    projectId: string;
    taskId: string;
    fileId: string;
    profileId: string;
    amount: string;
    unit: string;
    dueAt: string;
    completed: string;
    blocked: string;
    next: string;
};

export const EMPTY_STRUCTURED_ACTION_DRAFT: StructuredActionDraft = {
    kind: null,
    title: '',
    summary: '',
    note: '',
    projectId: '',
    taskId: '',
    fileId: '',
    profileId: '',
    amount: '',
    unit: '',
    dueAt: '',
    completed: '',
    blocked: '',
    next: '',
};

export function dedupeContextChips(chips: MessageContextChip[]) {
    const seen = new Set<string>();
    const next: MessageContextChip[] = [];
    for (const chip of chips) {
        const key = `${chip.kind}:${chip.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(chip);
    }
    return next;
}
