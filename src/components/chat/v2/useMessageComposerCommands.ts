'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { MessageContextChip } from '@/lib/messages/structured';
import type { MessagingStructuredCatalogV2 } from '@/app/actions/messaging/collaboration';
import {
    EMPTY_STRUCTURED_ACTION_DRAFT,
    STRUCTURED_ACTION_OPTIONS,
    dedupeContextChips,
    type SlashMenuItem,
    type StructuredActionDraft,
    type StructuredComposerKind,
} from './message-composer-v2-shared';

interface UseMessageComposerCommandsParams {
    conversationId: string;
    draft: string;
    setDraft: (conversationId: string, value: string) => void;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    participants?: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
    structuredActionsEnabled: boolean;
    structuredCatalogData?: MessagingStructuredCatalogV2;
}

export function useMessageComposerCommands({
    conversationId,
    draft,
    setDraft,
    inputRef,
    participants,
    structuredActionsEnabled,
    structuredCatalogData,
}: UseMessageComposerCommandsParams) {
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [pendingContextChips, setPendingContextChips] = useState<MessageContextChip[]>([]);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState('');
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const [structuredDraft, setStructuredDraft] = useState<StructuredActionDraft>(EMPTY_STRUCTURED_ACTION_DRAFT);

    useEffect(() => {
        setMentionQuery(null);
        setPendingContextChips([]);
        setSlashMenuOpen(false);
        setSlashQuery('');
        setSlashSelectedIndex(0);
        setStructuredDraft(EMPTY_STRUCTURED_ACTION_DRAFT);
    }, [conversationId]);

    const slashItems = useMemo<SlashMenuItem[]>(() => {
        const actionItems: SlashMenuItem[] = STRUCTURED_ACTION_OPTIONS.map((option) => ({
            key: option.kind,
            section: 'Actions',
            label: option.label,
            description: option.description,
            type: 'action',
            actionKind: option.kind,
        }));

        const contextItems: SlashMenuItem[] = [
            ...(structuredCatalogData?.projects || []).map((project) => ({
                key: `project:${project.id}`,
                section: 'Context' as const,
                label: project.title,
                description: project.slug ? `Project · /${project.slug}` : 'Project',
                type: 'chip' as const,
                chip: {
                    kind: 'project' as const,
                    id: project.id,
                    label: project.title,
                    subtitle: project.slug ? `/${project.slug}` : null,
                },
            })),
            ...(structuredCatalogData?.tasks || []).map((task) => ({
                key: `task:${task.id}`,
                section: 'Context' as const,
                label: `#${task.taskNumber} ${task.title}`,
                description: 'Task',
                type: 'chip' as const,
                chip: {
                    kind: 'task' as const,
                    id: task.id,
                    label: `#${task.taskNumber} ${task.title}`,
                    subtitle: null,
                },
            })),
            ...(structuredCatalogData?.files || []).map((file) => ({
                key: `file:${file.id}`,
                section: 'Context' as const,
                label: file.name,
                description: file.path,
                type: 'chip' as const,
                chip: {
                    kind: 'file' as const,
                    id: file.id,
                    label: file.name,
                    subtitle: file.path,
                },
            })),
            ...(structuredCatalogData?.profiles || []).map((profile) => ({
                key: `profile:${profile.id}`,
                section: 'Context' as const,
                label: profile.label,
                description: profile.subtitle || 'Profile',
                type: 'chip' as const,
                chip: {
                    kind: 'profile' as const,
                    id: profile.id,
                    label: profile.label,
                    subtitle: profile.subtitle,
                },
            })),
        ];

        const allItems = [...actionItems, ...contextItems];
        if (!slashQuery.trim()) {
            return allItems;
        }

        const normalizedQuery = slashQuery.trim().toLowerCase();
        return allItems.filter((item) =>
            item.label.toLowerCase().includes(normalizedQuery)
            || item.description.toLowerCase().includes(normalizedQuery),
        );
    }, [slashQuery, structuredCatalogData?.files, structuredCatalogData?.profiles, structuredCatalogData?.projects, structuredCatalogData?.tasks]);

    const catalogChipLookups = useMemo(() => ({
        projects: new Map((structuredCatalogData?.projects || []).map((project) => [
            project.id,
            {
                kind: 'project' as const,
                id: project.id,
                label: project.title,
                subtitle: project.slug ? `/${project.slug}` : null,
            },
        ])),
        tasks: new Map((structuredCatalogData?.tasks || []).map((task) => [
            task.id,
            {
                kind: 'task' as const,
                id: task.id,
                label: `#${task.taskNumber} ${task.title}`,
                subtitle: null,
            },
        ])),
        files: new Map((structuredCatalogData?.files || []).map((file) => [
            file.id,
            {
                kind: 'file' as const,
                id: file.id,
                label: file.name,
                subtitle: file.path,
            },
        ])),
        profiles: new Map((structuredCatalogData?.profiles || []).map((profile) => [
            profile.id,
            {
                kind: 'profile' as const,
                id: profile.id,
                label: profile.label,
                subtitle: profile.subtitle,
            },
        ])),
    }), [
        structuredCatalogData?.files,
        structuredCatalogData?.profiles,
        structuredCatalogData?.projects,
        structuredCatalogData?.tasks,
    ]);

    const openSlashMenu = useCallback((query: string = '') => {
        if (!structuredActionsEnabled) return;
        setSlashMenuOpen(true);
        setSlashQuery(query);
        setSlashSelectedIndex(0);
    }, [structuredActionsEnabled]);

    const closeSlashMenu = useCallback(() => {
        setSlashMenuOpen(false);
        setSlashQuery('');
        setSlashSelectedIndex(0);
        setStructuredDraft(EMPTY_STRUCTURED_ACTION_DRAFT);
    }, []);

    const clearStructuredDraft = useCallback(() => {
        setStructuredDraft(EMPTY_STRUCTURED_ACTION_DRAFT);
    }, []);

    const returnToSlashList = useCallback(() => {
        clearStructuredDraft();
        setSlashMenuOpen(true);
        setSlashQuery('');
        setSlashSelectedIndex(0);
        inputRef.current?.focus();
    }, [clearStructuredDraft, inputRef]);

    const getActiveSlashTokenRange = useCallback(() => {
        const textarea = inputRef.current;
        if (!textarea) return null;
        const cursorPos = textarea.selectionStart ?? draft.length;
        const textBeforeCursor = draft.slice(0, cursorPos);
        const match = textBeforeCursor.match(/(?:^|\s)\/([^\s]*)$/);
        if (!match || typeof match.index !== 'number') return null;
        const slashOffset = match[0].lastIndexOf('/');
        return {
            start: match.index + slashOffset,
            end: cursorPos,
        };
    }, [draft, inputRef]);

    const consumeSlashToken = useCallback(() => {
        const range = getActiveSlashTokenRange();
        if (!range) return;
        const nextDraft = `${draft.slice(0, range.start)}${draft.slice(range.end)}`.replace(/\s{2,}/g, ' ');
        setDraft(conversationId, nextDraft);
        requestAnimationFrame(() => {
            if (!inputRef.current) return;
            const nextCursor = Math.max(0, range.start);
            inputRef.current.focus();
            inputRef.current.setSelectionRange(nextCursor, nextCursor);
        });
    }, [conversationId, draft, getActiveSlashTokenRange, inputRef, setDraft]);

    const togglePendingChip = useCallback((chip: MessageContextChip) => {
        consumeSlashToken();
        setPendingContextChips((prev) => {
            const exists = prev.some((current) => current.kind === chip.kind && current.id === chip.id);
            if (exists) {
                return prev.filter((current) => !(current.kind === chip.kind && current.id === chip.id));
            }
            return dedupeContextChips([...prev, chip]);
        });
        closeSlashMenu();
    }, [closeSlashMenu, consumeSlashToken]);

    const openStructuredDraft = useCallback((kind: StructuredComposerKind) => {
        consumeSlashToken();
        const linkedProjectId = structuredCatalogData?.linkedProjectId || structuredCatalogData?.projects[0]?.id || '';
        const linkedTaskId = structuredCatalogData?.tasks[0]?.id || '';
        const linkedFileId = structuredCatalogData?.files[0]?.id || '';
        const linkedProfileId = structuredCatalogData?.profiles[0]?.id || '';

        setStructuredDraft({
            kind,
            title: STRUCTURED_ACTION_OPTIONS.find((option) => option.kind === kind)?.label.replace(/^Send /, '').replace(/^Confirm /, '') || '',
            summary: '',
            note: '',
            projectId: kind === 'project_invite' || kind === 'feedback_request' || kind === 'task_approval' || kind === 'handoff_summary'
                ? linkedProjectId
                : '',
            taskId: kind === 'task_approval' ? linkedTaskId : '',
            fileId: kind === 'feedback_request' ? linkedFileId : '',
            profileId: linkedProfileId,
            amount: '',
            unit: '',
            dueAt: '',
            completed: '',
            blocked: '',
            next: '',
        });
        setSlashMenuOpen(true);
        setSlashQuery('');
        setSlashSelectedIndex(0);
    }, [consumeSlashToken, structuredCatalogData?.files, structuredCatalogData?.linkedProjectId, structuredCatalogData?.profiles, structuredCatalogData?.projects, structuredCatalogData?.tasks]);

    useEffect(() => {
        setSlashSelectedIndex((current) => {
            if (slashItems.length === 0) return 0;
            return Math.min(current, Math.max(0, slashItems.length - 1));
        });
    }, [slashItems.length]);

    const handleSlashItemSelect = useCallback((item: SlashMenuItem) => {
        if (item.type === 'chip') {
            togglePendingChip(item.chip);
            return;
        }
        openStructuredDraft(item.actionKind);
    }, [openStructuredDraft, togglePendingChip]);

    const handleMentionSelect = useCallback((participant: { username: string | null }) => {
        if (!participant.username || !inputRef.current) return;
        const username = participant.username;
        const textarea = inputRef.current;
        const cursorPos = textarea.selectionStart;
        const textBeforeCursor = draft.slice(0, cursorPos);
        const mentionStart = textBeforeCursor.lastIndexOf('@');
        if (mentionStart === -1) return;
        const newText = draft.slice(0, mentionStart) + `@${username} ` + draft.slice(cursorPos);
        setDraft(conversationId, newText);
        setMentionQuery(null);
        requestAnimationFrame(() => {
            const newPos = mentionStart + username.length + 2;
            textarea.setSelectionRange(newPos, newPos);
            textarea.focus();
        });
    }, [conversationId, draft, inputRef, setDraft]);

    const applyGuidedTemplate = useCallback((template: string) => {
        setDraft(conversationId, template);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            if (!inputRef.current) return;
            const cursor = template.length;
            inputRef.current.setSelectionRange(cursor, cursor);
        });
    }, [conversationId, inputRef, setDraft]);

    const handleRemoveContextChip = useCallback((chip: MessageContextChip) => {
        setPendingContextChips((prev) =>
            prev.filter((current) => !(current.kind === chip.kind && current.id === chip.id)),
        );
        setStructuredDraft((current) => ({
            ...current,
            projectId: current.projectId === chip.id && chip.kind === 'project' ? '' : current.projectId,
            taskId: current.taskId === chip.id && chip.kind === 'task' ? '' : current.taskId,
            fileId: current.fileId === chip.id && chip.kind === 'file' ? '' : current.fileId,
            profileId: current.profileId === chip.id && chip.kind === 'profile' ? '' : current.profileId,
        }));
    }, []);

    const buildStructuredDraftContextChips = useCallback((draftState: StructuredActionDraft) => {
        return dedupeContextChips([
            ...pendingContextChips,
            ...(draftState.projectId ? [catalogChipLookups.projects.get(draftState.projectId)].filter(Boolean) as MessageContextChip[] : []),
            ...(draftState.taskId ? [catalogChipLookups.tasks.get(draftState.taskId)].filter(Boolean) as MessageContextChip[] : []),
            ...(draftState.fileId ? [catalogChipLookups.files.get(draftState.fileId)].filter(Boolean) as MessageContextChip[] : []),
            ...(draftState.profileId ? [catalogChipLookups.profiles.get(draftState.profileId)].filter(Boolean) as MessageContextChip[] : []),
        ]);
    }, [catalogChipLookups.files, catalogChipLookups.profiles, catalogChipLookups.projects, catalogChipLookups.tasks, pendingContextChips]);

    const syncCommandsFromInput = useCallback((nextValue: string, cursorPos: number) => {
        const textBeforeCursor = nextValue.slice(0, cursorPos);
        const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
        if (mentionMatch && participants && participants.length > 0) {
            setMentionQuery(mentionMatch[1]);
        } else {
            setMentionQuery(null);
        }

        if (!structuredDraft.kind && structuredActionsEnabled) {
            const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([^\s]*)$/);
            if (slashMatch) {
                openSlashMenu(slashMatch[1] ?? '');
            } else if (slashMenuOpen) {
                closeSlashMenu();
            }
        }
    }, [closeSlashMenu, openSlashMenu, participants, slashMenuOpen, structuredActionsEnabled, structuredDraft.kind]);

    const activeStructuredOption = structuredDraft.kind
        ? STRUCTURED_ACTION_OPTIONS.find((option) => option.kind === structuredDraft.kind) ?? null
        : null;
    const structuredSubmitLabel = activeStructuredOption
        ? activeStructuredOption.kind === 'rate_share'
            ? 'Send rate'
            : activeStructuredOption.kind === 'handoff_summary'
                ? 'Send handoff'
                : 'Send card'
        : 'Send card';
    const hasStructuredDraft = Boolean(structuredDraft.kind);
    const visibleContextChips = hasStructuredDraft
        ? buildStructuredDraftContextChips(structuredDraft)
        : pendingContextChips;

    return {
        mentionQuery,
        setMentionQuery,
        pendingContextChips,
        setPendingContextChips,
        slashMenuOpen,
        slashQuery,
        slashSelectedIndex,
        setSlashSelectedIndex,
        structuredDraft,
        setStructuredDraft,
        slashItems,
        openSlashMenu,
        closeSlashMenu,
        returnToSlashList,
        clearStructuredDraft,
        handleSlashItemSelect,
        handleMentionSelect,
        applyGuidedTemplate,
        handleRemoveContextChip,
        buildStructuredDraftContextChips,
        syncCommandsFromInput,
        activeStructuredOption,
        structuredSubmitLabel,
        hasStructuredDraft,
        visibleContextChips,
    };
}
