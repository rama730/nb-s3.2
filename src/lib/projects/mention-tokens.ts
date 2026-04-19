// ============================================================================
// Task Panel Overhaul - Wave 4: @mention token format
//
// Mentions inside task comments are stored inline in `task_comments.content`
// as stable tokens of the shape:
//
//     @{00000000-0000-0000-0000-000000000000|DisplayName}
//
// The trailing `}` is the terminator: it makes the grammar unambiguous even
// when display names contain spaces or punctuation, because `}` is stripped
// from names on the write path (see sanitizeMentionDisplayName).
//
// The reasons for embedding the tokens in the content column (rather than
// building a rich document model from scratch):
//
//   - Pre-mention comments continue to render as plain text: the parser
//     treats anything that is not a valid token as prose.
//   - Notifications and inbox queries read from the `comment_mentions` table
//     (written alongside the comment); the tokens in the content column drive
//     only client-side rendering of chips.
//   - Re-rendering a comment never needs a join back to `profiles`: the
//     display name is carried in the token and is safe to show verbatim. If a
//     mentioned user renames themselves later, the chip shows the name as it
//     was at the moment of mention (same semantics as Slack / Linear).
//
// This module is pure and isomorphic so it can be used from server actions,
// React components, and Node tests with no browser dependencies.
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// We pre-compile the matcher for the full token. The name is capped at 120
// characters and may not contain the characters we use as delimiters or
// newlines; buildMentionToken enforces the same rules on the write path so
// the tokens stay unambiguous.
const MENTION_TOKEN_RE =
    /@\{([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\|([^@{}|\n]{1,120})\}/g;

export const MENTION_DISPLAY_NAME_MAX_LENGTH = 120;

export type MentionSegment =
    | { type: "text"; value: string }
    | { type: "mention"; userId: string; displayName: string };

export interface ParsedMentions {
    /** The input with mention tokens replaced by "@DisplayName"; safe for plain-text destinations. */
    plainText: string;
    /** Distinct mentioned user ids, in order of first appearance. */
    mentionIds: string[];
    /** Alternating text / mention segments covering the full input. */
    segments: MentionSegment[];
}

/**
 * Normalize a display name so it can safely live inside a mention token.
 *
 * Collapses whitespace, strips disallowed delimiter characters and newlines,
 * and truncates to MENTION_DISPLAY_NAME_MAX_LENGTH. The result is guaranteed
 * to round-trip through parseMentions.
 */
export function sanitizeMentionDisplayName(raw: string): string {
    const collapsed = (raw ?? "")
        .replace(/[\r\n\t]/g, " ")
        .replace(/[{}|@]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (collapsed.length <= MENTION_DISPLAY_NAME_MAX_LENGTH) return collapsed;
    return collapsed.slice(0, MENTION_DISPLAY_NAME_MAX_LENGTH).trimEnd();
}

/**
 * Build a mention token string. Throws if the user id is not a valid UUID;
 * server and client both rely on that invariant to keep the token grammar
 * unambiguous, so we fail loud rather than silently skip a mention.
 */
export function buildMentionToken(params: { userId: string; displayName: string }): string {
    if (!UUID_RE.test(params.userId)) {
        throw new Error(`buildMentionToken: invalid userId "${params.userId}"`);
    }
    const safeName = sanitizeMentionDisplayName(params.displayName) || "user";
    return `@{${params.userId.toLowerCase()}|${safeName}}`;
}

/**
 * Parse the raw content column into plain text + mention ids + segments.
 *
 * Unknown or malformed tokens pass through untouched as plain text; we never
 * throw on parse, because the content column can legitimately contain prose
 * shaped like "@{something}" from before mentions existed.
 */
export function parseMentions(raw: string): ParsedMentions {
    const segments: MentionSegment[] = [];
    const plainTextParts: string[] = [];
    const mentionIds: string[] = [];
    const seen = new Set<string>();

    if (!raw) {
        return { plainText: "", mentionIds: [], segments: [] };
    }

    MENTION_TOKEN_RE.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = MENTION_TOKEN_RE.exec(raw)) !== null) {
        const [fullMatch, rawId, rawName] = match;
        const userId = rawId.toLowerCase();

        if (match.index > lastIndex) {
            const textChunk = raw.slice(lastIndex, match.index);
            segments.push({ type: "text", value: textChunk });
            plainTextParts.push(textChunk);
        }

        const displayName = rawName;
        segments.push({ type: "mention", userId, displayName });
        plainTextParts.push(`@${displayName}`);

        if (!seen.has(userId)) {
            seen.add(userId);
            mentionIds.push(userId);
        }

        lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < raw.length) {
        const tail = raw.slice(lastIndex);
        segments.push({ type: "text", value: tail });
        plainTextParts.push(tail);
    }

    return {
        plainText: plainTextParts.join(""),
        mentionIds,
        segments,
    };
}

/**
 * Convenience wrapper around parseMentions when only the ids are needed. Safe
 * for re-use on both client (composer validation) and server (writing rows
 * into comment_mentions).
 */
export function extractMentionIds(raw: string): string[] {
    return parseMentions(raw).mentionIds;
}

/**
 * Build raw content from an explicit list of segments. Used by the composer
 * when turning its contentEditable DOM into the string that gets shipped to
 * the server. Enforces the same delimiter discipline as buildMentionToken.
 */
export function serializeSegments(segments: MentionSegment[]): string {
    let out = "";
    for (const segment of segments) {
        if (segment.type === "text") {
            out += segment.value;
            continue;
        }
        out += buildMentionToken({
            userId: segment.userId,
            displayName: segment.displayName,
        });
    }
    return out;
}

export function isValidUserId(value: string): boolean {
    return UUID_RE.test(value);
}
