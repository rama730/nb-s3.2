"use client";

// ============================================================================
// Task Panel Overhaul - Wave 4: CommentBody
//
// Renders the raw `task_comments.content` string as a mix of plain text and
// inline mention chips. The raw form embeds mentions as `@{uuid|DisplayName}`
// tokens; this component delegates parsing to `parseMentions` and then maps
// each segment to a React node.
//
// Pre-mention comments have no tokens at all, so `parseMentions` returns a
// single text segment and the output matches the previous plain-text render.
// ============================================================================

import * as React from "react";

import { parseMentions } from "@/lib/projects/mention-tokens";
import { cn } from "@/lib/utils";

interface CommentBodyProps {
    content: string;
    viewerUserId?: string | null;
    className?: string;
}

export function CommentBody({ content, viewerUserId, className }: CommentBodyProps) {
    const { segments } = React.useMemo(() => parseMentions(content), [content]);

    return (
        <div className={cn("whitespace-pre-wrap break-words", className)}>
            {segments.map((segment, index) => {
                if (segment.type === "text") {
                    // React will collapse consecutive text segments naturally;
                    // the key mixes index so two identical strings stay stable.
                    return <React.Fragment key={`t-${index}`}>{segment.value}</React.Fragment>;
                }
                const isMentioningViewer =
                    viewerUserId != null && segment.userId === viewerUserId;
                return (
                    <span
                        key={`m-${index}-${segment.userId}`}
                        data-mention-id={segment.userId}
                        className={cn(
                            "inline-flex items-center rounded-md px-1.5 py-px text-[13px] font-medium align-baseline",
                            isMentioningViewer
                                ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:ring-amber-700/60"
                                : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200",
                        )}
                    >
                        @{segment.displayName}
                    </span>
                );
            })}
        </div>
    );
}

export default CommentBody;
