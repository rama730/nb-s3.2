"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';

const CARET_COLORS = [
    '#2563eb',
    '#16a34a',
    '#dc2626',
    '#9333ea',
    '#0891b2',
    '#ea580c',
    '#be123c',
    '#4f46e5',
];

function stableCaretColor(seed: string) {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }
    return CARET_COLORS[Math.abs(hash) % CARET_COLORS.length];
}

function normalizeMarkdown(md: string): string {
    return md
        .replace(/\r\n/g, "\n")
        .replace(/\s+\n/g, "\n")
        .trim();
}

export function ProjectReadmeWysiwygEditor({
    ydoc,
    provider,
    initialContent,
    currentUserName,
    onContentChange,
    synced,
}: {
    ydoc: Y.Doc;
    provider: HocuspocusProvider | null;
    initialContent?: string;
    currentUserName?: string;
    onContentChange?: (markdown: string) => void;
    synced?: boolean;
}) {
    const collaboratorName = currentUserName || 'Teammate';
    const collaboratorColor = useMemo(() => stableCaretColor(collaboratorName), [collaboratorName]);
    const pendingMarkdownRef = useRef<string | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSentMarkdownRef = useRef<string | null>(null);
    const isSettingContentRef = useRef(false);

    const safeProvider = useMemo(() => {
        if (!provider || !provider.awareness) return provider;
        return {
            ...provider,
            on: provider.on.bind(provider),
            off: provider.off.bind(provider),
            awareness: {
                ...provider.awareness,
                getStates: () => {
                    const states = provider.awareness!.getStates();
                    const cleanStates = new Map();
                    states.forEach((state, clientId) => {
                        // Filter out CodeMirror cursors (they are objects with { client, clock })
                        // TipTap expects flat numbers. If we pass objects, TipTap crashes.
                        if (state.cursor && typeof state.cursor.anchor === 'object') {
                            const { cursor, ...rest } = state;
                            cleanStates.set(clientId, rest);
                        } else {
                            cleanStates.set(clientId, state);
                        }
                    });
                    return cleanStates;
                },
                on: (event: any, handler: any) => provider.awareness!.on(event, handler),
                off: (event: any, handler: any) => provider.awareness!.off(event, handler),
                setLocalState: (state: any) => provider.awareness!.setLocalState(state),
                setLocalStateField: (field: string, value: any) => provider.awareness!.setLocalStateField(field, value),
                getLocalState: () => provider.awareness!.getLocalState(),
                clientID: provider.awareness!.clientID,
            }
        };
    }, [provider]);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                undoRedo: false, // History is handled by Yjs
            }),
            Markdown,
            Collaboration.configure({
                document: ydoc,
                field: 'tiptap',
            }),
            CollaborationCaret.configure({
                provider: safeProvider as any,
                user: {
                    name: collaboratorName,
                    color: collaboratorColor,
                },
            }),
        ],
        onUpdate({ editor, transaction }) {
            if (isSettingContentRef.current) {
                return;
            }
            const isRemote = transaction ? transaction.getMeta('y-sync$') !== undefined : !editor.isFocused;
            if (onContentChange && !isRemote) {
                const nextMarkdown = (editor.storage as any).markdown.getMarkdown();
                // If tiptap is completely empty and we haven't initialized it yet,
                // do not propagate empty content back to the parent to prevent wiping out the draft.
                if (nextMarkdown === "" && ydoc.getXmlFragment('tiptap').length === 0) {
                    return;
                }

                pendingMarkdownRef.current = nextMarkdown;
                if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
                flushTimerRef.current = setTimeout(() => {
                    flushTimerRef.current = null;
                    const nextContent = pendingMarkdownRef.current;
                    pendingMarkdownRef.current = null;
                    if (nextContent != null) {
                        lastSentMarkdownRef.current = nextContent;
                        onContentChange(nextContent);
                    }
                }, 250);
            }
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm dark:prose-invert max-w-none w-full break-words overflow-x-hidden focus:outline-none h-full min-h-0 overflow-y-auto px-6 py-8',
            },
        },
    });

    useEffect(() => {
        // Overwrite or sync the visual content if the latest code editor markdown differs
        if (synced && editor && initialContent) {
            if (initialContent === lastSentMarkdownRef.current) {
                return;
            }

            const isTiptapEmpty = ydoc.getXmlFragment('tiptap').length === 0;
            if (isTiptapEmpty) {
                setTimeout(() => {
                    if (ydoc.getXmlFragment('tiptap').length === 0) {
                        const systemMap = ydoc.getMap('system');
                        if (!systemMap.has('initialized_tiptap')) {
                            ydoc.transact(() => {
                                systemMap.set('initialized_tiptap', true);
                            });
                            isSettingContentRef.current = true;
                            try {
                                editor.commands.setContent(initialContent);
                            } finally {
                                isSettingContentRef.current = false;
                            }
                            lastSentMarkdownRef.current = initialContent;
                        }
                    }
                }, 500 + Math.random() * 2000);
            } else {
                const currentMarkdown = (editor.storage as any).markdown.getMarkdown();
                if (normalizeMarkdown(currentMarkdown) !== normalizeMarkdown(initialContent)) {
                    isSettingContentRef.current = true;
                    try {
                        editor.commands.setContent(initialContent);
                    } finally {
                        isSettingContentRef.current = false;
                    }
                }
                lastSentMarkdownRef.current = initialContent;
            }
        }
    }, [editor, initialContent, synced, ydoc, provider]);

    useEffect(() => () => {
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    }, []);

    if (!editor) {
        return null;
    }

    return (
        <div className="w-full h-full min-h-0 bg-white dark:bg-zinc-950 flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden">
                <EditorContent editor={editor} className="h-full w-full" />
            </div>
        </div>
    );
}
