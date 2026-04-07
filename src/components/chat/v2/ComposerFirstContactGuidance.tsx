'use client';

interface ComposerFirstContactGuidanceProps {
    templates: readonly string[];
    onSelectTemplate: (template: string) => void;
}

export function ComposerFirstContactGuidance({
    templates,
    onSelectTemplate,
}: ComposerFirstContactGuidanceProps) {
    return (
        <div className="mb-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                First message guidance
            </div>
            <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                Start with a clear introduction and a short reason for reaching out. You can still send freeform text at any time.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                {templates.map((template) => (
                    <button
                        key={template}
                        type="button"
                        onClick={() => onSelectTemplate(template)}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        {template}
                    </button>
                ))}
            </div>
        </div>
    );
}
