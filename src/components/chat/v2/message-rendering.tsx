'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { parseSafeLinkToken } from '@/lib/messages/safe-links';
import { cn } from '@/lib/utils';

const LINK_OR_MENTION_REGEX = /((?<!\S)@[a-zA-Z0-9_]{2,32}\b|(?:https?:\/\/|www\.)[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
export const MESSAGE_TEXT_BASE_CLASS = 'msg-message-text leading-relaxed';

function renderInlineTextWithMentions(text: string, isOwn: boolean, baseKey: string) {
    const parts = text.split(LINK_OR_MENTION_REGEX);
    return parts.map((part, index) => {
        if (part.startsWith('@')) {
            const username = part.slice(1).toLowerCase();
            return (
                <a
                    key={`${baseKey}-mention-${index}`}
                    href={`/u/${username}`}
                    className={`font-semibold underline underline-offset-2 ${
                        isOwn ? 'text-white' : 'text-primary'
                    }`}
                >
                    {part}
                </a>
            );
        }

        const safeLink = parseSafeLinkToken(part);
        if (safeLink) {
            return (
                <span key={`${baseKey}-link-wrap-${index}`}>
                    <a
                        href={safeLink.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow ugc"
                        className={`break-all underline ${isOwn ? 'text-white' : 'text-primary'}`}
                    >
                        {safeLink.display}
                    </a>
                    {safeLink.trailing}
                </span>
            );
        }

        return <span key={`${baseKey}-txt-${index}`}>{part}</span>;
    });
}

export function renderTextWithMentions(text: string, isOwn: boolean) {
    const inlineParts = text.split(/(`[^`\n]+`)/g);
    return inlineParts.map((part, index) => {
        if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
            return (
                <code
                    key={`inline-code-${index}`}
                    className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[0.9em]',
                        isOwn
                            ? 'bg-black/25 text-white'
                            : 'bg-zinc-200 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-100',
                    )}
                >
                    {part.slice(1, -1)}
                </code>
            );
        }

        return renderInlineTextWithMentions(part, isOwn, `inline-text-${index}`);
    });
}

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
    'cpp': 'C++',
    'cxx': 'C++',
    'c++': 'C++',
    'ts': 'TypeScript',
    'tsx': 'TypeScript (React)',
    'js': 'JavaScript',
    'jsx': 'JavaScript (React)',
    'py': 'Python',
    'python': 'Python',
    'sh': 'Bash',
    'bash': 'Bash',
    'zsh': 'Bash',
    'css': 'CSS',
    'html': 'HTML',
    'json': 'JSON',
    'sql': 'SQL',
    'go': 'Go',
    'rs': 'Rust',
    'rust': 'Rust',
    'java': 'Java',
    'c': 'C',
    'cs': 'C#',
    'csharp': 'C#',
    'php': 'PHP',
    'ruby': 'Ruby',
    'rb': 'Ruby',
    'swift': 'Swift',
    'kt': 'Kotlin',
    'kotlin': 'Kotlin',
    'dart': 'Dart',
    'xml': 'XML',
    'yaml': 'YAML',
    'yml': 'YAML',
    'md': 'Markdown',
    'markdown': 'Markdown',
};

function getDisplayLanguage(lang: string | null): string {
    if (!lang) return 'Code';
    const normalized = lang.toLowerCase();
    return LANGUAGE_DISPLAY_NAMES[normalized] || lang;
}

export function CodeSegmentV2({
    code,
    language,
    isOwn,
}: {
    code: string;
    language: string | null;
    isOwn: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const copyTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
                copyTimeoutRef.current = null;
            }
        };
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
            copyTimeoutRef.current = window.setTimeout(() => {
                copyTimeoutRef.current = null;
                setCopied(false);
            }, 1200);
        } catch {
            toast.error('Failed to copy code');
        }
    }, [code]);

    return (
        <div
            className={cn(
                'msg-rich-content max-w-full min-w-0 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-sm',
                isOwn ? 'text-zinc-100' : 'text-zinc-100',
            )}
        >
            <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-zinc-300">
                <span>{getDisplayLanguage(language)}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
            </div>
            <pre className="max-w-full overflow-x-auto px-3 py-2 text-[12px] leading-5 text-zinc-100">
                <code>{code}</code>
            </pre>
        </div>
    );
}
