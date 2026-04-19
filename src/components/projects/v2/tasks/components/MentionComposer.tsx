"use client";

// ============================================================================
// Task Panel Overhaul - Wave 4: MentionComposer
//
// A contentEditable composer that understands `@mention` tokens. The composer
// is the source of truth for two kinds of content:
//
//   - Plain text that the user typed. Stays in native text nodes so the
//     browser handles caret movement, IME composition, undo, etc.
//   - Atomic mention chips rendered as `<span contenteditable="false">` with
//     `data-mention-id` / `data-mention-name` attributes.
//
// Serialization round-trips through `@/lib/projects/mention-tokens`, so the
// authoritative representation that gets sent to the server is the raw string
// `@{uuid|Display Name}` - identical to what comes back down on read.
//
// Lifecycle:
//   1. Parent passes `resetKey`. When it changes (after a successful submit),
//      we clear the editor. We do NOT attempt to re-render the editor from a
//      `value` prop; React and contentEditable fight hard in that model, and
//      the composer is always a fresh draft anyway.
//   2. Every input -> we re-serialize the editor and notify the parent via
//      `onDraftChange(raw)` so they can show typing indicators, disable the
//      submit button, etc.
//   3. When the caret is inside an `@query` run, we fetch the project members
//      endpoint, render the `MentionAutocomplete`, and handle keyboard
//      navigation locally.
// ============================================================================

import * as React from "react";

import {
    buildMentionToken,
    MENTION_DISPLAY_NAME_MAX_LENGTH,
    sanitizeMentionDisplayName,
} from "@/lib/projects/mention-tokens";
import { cn } from "@/lib/utils";

import {
    MentionAutocomplete,
    type MentionCandidate,
} from "./MentionAutocomplete";

// ---------------------------------------------------------------------------
// Types + props
// ---------------------------------------------------------------------------

export interface MentionComposerProps {
    projectId: string;
    placeholder?: string;
    disabled?: boolean;
    /** Autofocus the editor on mount. */
    autoFocus?: boolean;
    /** Reset counter - bumping this clears the editor. */
    resetKey?: number;
    /** Called on every input with the serialized raw string (tokens intact). */
    onDraftChange?: (raw: string) => void;
    /** Called when the user hits Ctrl/Cmd + Enter while the menu is closed. */
    onSubmit?: () => void;
    className?: string;
    "aria-label"?: string;
}

// Shape of the candidate fetch response; stays narrow to match what the API
// route actually returns.
interface FetchedMember {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    role?: "owner" | "admin" | "member" | "viewer";
}

interface MentionDetectState {
    query: string;
    textNode: Text;
    atOffset: number;
    cursorOffset: number;
    anchorRect: { top: number; left: number; height: number };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function clearEditor(root: HTMLElement) {
    while (root.firstChild) {
        root.removeChild(root.firstChild);
    }
}

function serializeEditor(root: HTMLElement): string {
    let out = "";

    const walk = (node: ChildNode) => {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent ?? "";
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = node as HTMLElement;
        const mentionId = el.dataset?.mentionId;
        if (mentionId) {
            const rawName =
                el.dataset.mentionName ?? el.textContent?.replace(/^@/, "") ?? "user";
            try {
                out += buildMentionToken({ userId: mentionId, displayName: rawName });
            } catch {
                // Invalid id from a hand-crafted DOM: fall back to plain text so
                // we never drop user content.
                out += `@${rawName}`;
            }
            return;
        }

        if (el.tagName === "BR") {
            out += "\n";
            return;
        }

        // Treat block-level wrappers (`<div>`, `<p>`) as implicit newlines so
        // multi-line input round-trips correctly on browsers that insert
        // `<div>` for each Enter key.
        const isBlock = el.tagName === "DIV" || el.tagName === "P";
        const needsLeadingNewline =
            isBlock && out.length > 0 && !out.endsWith("\n");
        if (needsLeadingNewline) out += "\n";
        el.childNodes.forEach(walk);
    };

    root.childNodes.forEach(walk);
    // Trim a trailing newline that the last `<div>` insertion would have added.
    return out.replace(/\n+$/, "");
}

function findAncestorEditor(node: Node | null, editor: HTMLElement): boolean {
    let current: Node | null = node;
    while (current) {
        if (current === editor) return true;
        current = current.parentNode;
    }
    return false;
}

function detectMentionState(
    editor: HTMLElement,
): MentionDetectState | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;

    const { startContainer, startOffset } = range;
    if (!findAncestorEditor(startContainer, editor)) return null;
    if (startContainer.nodeType !== Node.TEXT_NODE) return null;

    const textNode = startContainer as Text;
    const text = textNode.textContent ?? "";

    // Walk backwards from the caret to find a `@` that is either at the start
    // of the text node or preceded by whitespace. Anything containing internal
    // whitespace closes the mention window.
    let idx = startOffset - 1;
    while (idx >= 0) {
        const ch = text[idx];
        if (ch === "@") break;
        if (/\s/.test(ch)) return null;
        idx -= 1;
    }
    if (idx < 0) return null;
    if (idx > 0 && !/\s/.test(text[idx - 1])) return null;

    const query = text.slice(idx + 1, startOffset);
    if (query.length > MENTION_DISPLAY_NAME_MAX_LENGTH) return null;

    // Anchor the menu to the bounding rect of `@query` rather than to the
    // caret itself. This keeps the menu stable as the user types.
    const anchor = document.createRange();
    anchor.setStart(textNode, idx);
    anchor.setEnd(textNode, startOffset);
    const rect = anchor.getBoundingClientRect();

    return {
        query,
        textNode,
        atOffset: idx,
        cursorOffset: startOffset,
        anchorRect: { top: rect.top, left: rect.left, height: rect.height || 18 },
    };
}

// Replaces the `@query` run in `state.textNode` with a mention chip and puts
// the caret immediately after the trailing space that we insert.
function insertMentionAtDetectedRange(
    editor: HTMLElement,
    state: MentionDetectState,
    candidate: MentionCandidate,
) {
    const displayName =
        sanitizeMentionDisplayName(
            candidate.fullName || candidate.username || "user",
        ) || "user";

    const original = state.textNode;
    const fullText = original.textContent ?? "";
    const before = fullText.slice(0, state.atOffset);
    const after = fullText.slice(state.cursorOffset);

    const parent = original.parentNode;
    if (!parent) return;

    const beforeNode = document.createTextNode(before);
    const chip = document.createElement("span");
    chip.dataset.mentionId = candidate.id;
    chip.dataset.mentionName = displayName;
    chip.setAttribute("contenteditable", "false");
    chip.className =
        "inline-flex items-center rounded-md bg-indigo-100 px-1.5 py-px text-[13px] font-medium text-indigo-700 align-baseline dark:bg-indigo-900/40 dark:text-indigo-200";
    chip.textContent = `@${displayName}`;
    // A non-breaking space after the chip so the caret always has a text
    // node to live in; users expect typing to continue seamlessly after a
    // mention.
    const spacer = document.createTextNode("\u00A0");
    const afterNode = document.createTextNode(after);

    parent.insertBefore(beforeNode, original);
    parent.insertBefore(chip, original);
    parent.insertBefore(spacer, original);
    parent.insertBefore(afterNode, original);
    parent.removeChild(original);

    const newRange = document.createRange();
    newRange.setStart(afterNode, 0);
    newRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(newRange);

    // Fire one synthetic input so consumers that track the draft see the
    // updated content.
    editor.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 0; // show the full roster on bare `@`
const QUERY_DEBOUNCE_MS = 140;
const MAX_RESULTS = 10;

export function MentionComposer({
    projectId,
    placeholder,
    disabled,
    autoFocus,
    resetKey,
    onDraftChange,
    onSubmit,
    className,
    ...rest
}: MentionComposerProps) {
    const editorRef = React.useRef<HTMLDivElement | null>(null);
    const [isEmpty, setIsEmpty] = React.useState(true);

    // Autocomplete state kept here (parent does not need to know). We snapshot
    // the detection state in a ref so the selection handler can reuse it even
    // if the user moves the caret between render commits.
    const [menuState, setMenuState] = React.useState<MentionDetectState | null>(null);
    const menuStateRef = React.useRef<MentionDetectState | null>(null);
    const [candidates, setCandidates] = React.useState<MentionCandidate[]>([]);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // Keep the ref in sync so event handlers reading the "live" menu state
    // never race with stale React state.
    React.useEffect(() => {
        menuStateRef.current = menuState;
    }, [menuState]);

    // Reset the editor when `resetKey` bumps.
    React.useEffect(() => {
        if (resetKey === undefined) return;
        const editor = editorRef.current;
        if (!editor) return;
        clearEditor(editor);
        setIsEmpty(true);
        setMenuState(null);
        setCandidates([]);
        setActiveIndex(0);
    }, [resetKey]);

    React.useEffect(() => {
        if (!autoFocus) return;
        editorRef.current?.focus();
    }, [autoFocus]);

    // ---------------------------------------------------------------------
    // Candidate fetching (debounced)
    // ---------------------------------------------------------------------
    React.useEffect(() => {
        if (!menuState) {
            setCandidates([]);
            setLoading(false);
            setError(null);
            return;
        }
        const query = menuState.query;
        if (query.length < MIN_QUERY_LENGTH) {
            setCandidates([]);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        const handle = window.setTimeout(async () => {
            try {
                const url = new URL(
                    `/api/v1/projects/${projectId}/members`,
                    window.location.origin,
                );
                if (query) url.searchParams.set("q", query);
                const response = await fetch(url.toString(), {
                    method: "GET",
                    credentials: "same-origin",
                });
                if (!response.ok) {
                    throw new Error(`Lookup failed (${response.status})`);
                }
                const payload = (await response.json()) as {
                    success?: boolean;
                    data?: { members?: FetchedMember[] };
                };
                if (cancelled) return;
                if (!payload.success) {
                    setCandidates([]);
                    setError("Could not load teammates.");
                    return;
                }
                const members = (payload.data?.members ?? []).slice(0, MAX_RESULTS);
                setCandidates(members);
                setActiveIndex(0);
            } catch (err) {
                if (cancelled) return;
                setCandidates([]);
                setError(err instanceof Error ? err.message : "Lookup failed");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, QUERY_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [menuState, projectId]);

    // ---------------------------------------------------------------------
    // Input handling
    // ---------------------------------------------------------------------
    const handleInput = React.useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const raw = serializeEditor(editor);
        setIsEmpty(raw.length === 0);
        onDraftChange?.(raw);

        const detected = detectMentionState(editor);
        setMenuState(detected);
    }, [onDraftChange]);

    const closeMenu = React.useCallback(() => {
        setMenuState(null);
        setCandidates([]);
        setActiveIndex(0);
    }, []);

    const selectCandidate = React.useCallback(
        (candidate: MentionCandidate) => {
            const editor = editorRef.current;
            const state = menuStateRef.current;
            if (!editor || !state) return;
            insertMentionAtDetectedRange(editor, state, candidate);
            closeMenu();
        },
        [closeMenu],
    );

    // ---------------------------------------------------------------------
    // Keyboard handling
    // ---------------------------------------------------------------------
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (menuState && candidates.length > 0) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                    candidates.length === 0 ? 0 : (current + 1) % candidates.length,
                );
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) =>
                    candidates.length === 0
                        ? 0
                        : (current - 1 + candidates.length) % candidates.length,
                );
                return;
            }
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                const selected = candidates[activeIndex];
                if (selected) selectCandidate(selected);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                closeMenu();
                return;
            }
            if (event.key === "Tab") {
                event.preventDefault();
                const selected = candidates[activeIndex];
                if (selected) selectCandidate(selected);
                return;
            }
        }

        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit?.();
            return;
        }
    };

    // Chromium sometimes places the caret inside a chip when the user presses
    // backspace adjacent to one. We catch the case and delete the whole chip,
    // matching Slack / Linear behaviour.
    const handleBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
        const inputEvent = event as unknown as InputEvent;
        if (inputEvent.inputType !== "deleteContentBackward") return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const { startContainer, startOffset } = range;
        const editor = editorRef.current;
        if (!editor) return;

        // Case A: caret is right after a chip (previous sibling is a chip span).
        if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
            const textNode = startContainer as Text;
            const prev = textNode.previousSibling;
            if (
                prev &&
                prev.nodeType === Node.ELEMENT_NODE &&
                (prev as HTMLElement).dataset.mentionId
            ) {
                event.preventDefault();
                prev.parentNode?.removeChild(prev);
                editor.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }
        }
    };

    return (
        <div className={cn("relative", className)} data-testid="mention-composer">
            <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                aria-label={rest["aria-label"] ?? placeholder}
                aria-disabled={disabled}
                contentEditable={!disabled}
                suppressContentEditableWarning
                data-empty={isEmpty ? "true" : undefined}
                data-testid="mention-composer-editor"
                onInput={handleInput}
                onBeforeInput={handleBeforeInput}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                    // Delay close so pointer-down inside the menu lands first.
                    window.setTimeout(() => {
                        setMenuState((current) =>
                            current && menuStateRef.current === current ? null : current,
                        );
                    }, 120);
                }}
                className={cn(
                    "mention-composer min-h-[96px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm leading-6 text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100",
                    "whitespace-pre-wrap break-words",
                    disabled && "pointer-events-none opacity-60",
                )}
                data-placeholder={placeholder}
            />

            <style jsx>{`
                .mention-composer:empty::before,
                .mention-composer[data-empty="true"]::before {
                    content: attr(data-placeholder);
                    color: rgb(161 161 170); /* zinc-400 */
                    pointer-events: none;
                }
            `}</style>

            <MentionAutocomplete
                anchorRect={menuState ? menuState.anchorRect : null}
                query={menuState?.query ?? ""}
                candidates={candidates}
                activeIndex={activeIndex}
                loading={loading}
                error={error}
                onSelect={selectCandidate}
                onHoverIndex={(index) => setActiveIndex(index)}
            />
        </div>
    );
}

export default MentionComposer;
