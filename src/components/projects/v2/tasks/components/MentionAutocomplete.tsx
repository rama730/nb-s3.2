"use client";

// ============================================================================
// Task Panel Overhaul - Wave 4
// MentionAutocomplete: floating member picker anchored to the caret.
//
// This is a pure presentational component - the owning composer (CommentsTab)
// tracks the query string, active index, and caret position, and only calls
// into the autocomplete to render + handle pointer selection.
//
// Design notes:
//   - We render via React portal into <body> so the menu never gets clipped
//     by the tab panel's scroll container. This also keeps z-index
//     bookkeeping simple.
//   - Keyboard navigation (ArrowUp/Down/Enter/Escape) lives in the composer,
//     because only the composer owns the editable DOM and can decide what
//     Enter should do when the menu is closed.
//   - We highlight the first occurrence of the query inside the name /
//     username so the user can visually confirm the fuzzy match.
// ============================================================================

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface MentionCandidate {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    role?: "owner" | "admin" | "member" | "viewer";
}

interface MentionAutocompleteProps {
    /** Viewport-relative caret rectangle - the menu is positioned just below it. */
    anchorRect: { top: number; left: number; height: number } | null;
    /** Current `@query` (without the leading '@'). Used for highlighting. */
    query: string;
    candidates: MentionCandidate[];
    activeIndex: number;
    loading: boolean;
    error?: string | null;
    onSelect: (candidate: MentionCandidate) => void;
    onHoverIndex?: (index: number) => void;
}

const MENU_WIDTH = 320;
const MENU_OFFSET_Y = 6;

function getDisplayName(candidate: MentionCandidate): string {
    return (
        candidate.fullName?.trim() ||
        candidate.username?.trim() ||
        "Unnamed user"
    );
}

function getInitials(candidate: MentionCandidate): string {
    const source = getDisplayName(candidate);
    return source.charAt(0).toUpperCase() || "?";
}

// Case-insensitive first-match highlighter. Returns the string split into
// [before, match, after]. When the query is empty or not found, the full
// string is returned as `before`.
function splitAroundMatch(text: string, query: string) {
    if (!text) return { before: "", match: "", after: "" };
    if (!query) return { before: text, match: "", after: "" };
    const lower = text.toLowerCase();
    const index = lower.indexOf(query.toLowerCase());
    if (index < 0) return { before: text, match: "", after: "" };
    return {
        before: text.slice(0, index),
        match: text.slice(index, index + query.length),
        after: text.slice(index + query.length),
    };
}

function Highlighted({ text, query }: { text: string; query: string }) {
    const { before, match, after } = splitAroundMatch(text, query);
    if (!match) return <>{text}</>;
    return (
        <>
            {before}
            <mark className="bg-indigo-100 text-indigo-900 rounded-[2px] px-0.5 dark:bg-indigo-900/40 dark:text-indigo-100">
                {match}
            </mark>
            {after}
        </>
    );
}

export function MentionAutocomplete({
    anchorRect,
    query,
    candidates,
    activeIndex,
    loading,
    error,
    onSelect,
    onHoverIndex,
}: MentionAutocompleteProps) {
    // SSR-safe portal target. We lazily pin the document reference inside an
    // effect so nothing references `document` during the first render.
    const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(
        null,
    );
    React.useEffect(() => {
        setPortalTarget(typeof document !== "undefined" ? document.body : null);
    }, []);

    if (!anchorRect || !portalTarget) return null;

    // Clamp the menu inside the viewport so it never slides off the right edge
    // of a narrow task panel.
    const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : MENU_WIDTH + 16;
    const maxLeft = Math.max(0, viewportWidth - MENU_WIDTH - 8);
    const clampedLeft = Math.min(maxLeft, Math.max(8, anchorRect.left));
    const top = anchorRect.top + anchorRect.height + MENU_OFFSET_Y;

    const hasResults = candidates.length > 0;

    return createPortal(
        <div
            role="listbox"
            aria-label="Mention teammate"
            data-testid="mention-autocomplete"
            className="fixed z-[1000] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
            style={{ top, left: clampedLeft, width: MENU_WIDTH }}
            // Don't let a pointer drag in the menu steal focus from the composer.
            onMouseDown={(event) => event.preventDefault()}
        >
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <span>Mention teammate</span>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            </div>

            {error ? (
                <div className="px-3 py-3 text-xs text-rose-500">{error}</div>
            ) : null}

            {!error && !loading && !hasResults ? (
                <div className="px-3 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {query
                        ? `No teammates match "${query}".`
                        : "No teammates found on this project."}
                </div>
            ) : null}

            {hasResults ? (
                <ul className="max-h-60 overflow-y-auto py-1">
                    {candidates.map((candidate, index) => {
                        const active = index === activeIndex;
                        const displayName = getDisplayName(candidate);
                        return (
                            <li key={candidate.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    data-testid="mention-autocomplete-option"
                                    data-mention-candidate-id={candidate.id}
                                    onMouseDown={(event) => {
                                        // preventDefault keeps the composer focused;
                                        // we route through onSelect ourselves.
                                        event.preventDefault();
                                        onSelect(candidate);
                                    }}
                                    onMouseEnter={() => onHoverIndex?.(index)}
                                    className={cn(
                                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                                        active
                                            ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100"
                                            : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/60",
                                    )}
                                >
                                    <Avatar className="h-7 w-7 border border-zinc-200 dark:border-zinc-700">
                                        <AvatarImage
                                            src={candidate.avatarUrl || undefined}
                                            alt={displayName}
                                        />
                                        <AvatarFallback className="bg-zinc-200 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                            {getInitials(candidate)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">
                                            <Highlighted text={displayName} query={query} />
                                        </div>
                                        {candidate.username ? (
                                            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                                @
                                                <Highlighted
                                                    text={candidate.username}
                                                    query={query}
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                    {candidate.role && candidate.role !== "member" ? (
                                        <span
                                            className={cn(
                                                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                                                candidate.role === "owner"
                                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                                            )}
                                        >
                                            {candidate.role}
                                        </span>
                                    ) : null}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>,
        portalTarget,
    );
}

export default MentionAutocomplete;
