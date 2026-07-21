'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

interface UseMessageComposerCommandsParams {
    conversationId: string;
    draft: string;
    setDraft: (conversationId: string, value: string) => void;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    participants?: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
}

export function useMessageComposerCommands({
    conversationId,
    draft,
    setDraft,
    inputRef,
    participants,
}: UseMessageComposerCommandsParams) {
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);

    useEffect(() => {
        setMentionQuery(null);
    }, [conversationId]);

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

    const syncCommandsFromInput = useCallback((nextValue: string, cursorPos: number) => {
        const textBeforeCursor = nextValue.slice(0, cursorPos);
        const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
        if (mentionMatch && participants && participants.length > 0) {
            setMentionQuery(mentionMatch[1]!);
        } else {
            setMentionQuery(null);
        }
    }, [participants]);

    return {
        mentionQuery,
        setMentionQuery,
        handleMentionSelect,
        syncCommandsFromInput,
    };
}
