export type SemanticColor = 'zinc' | 'indigo' | 'rose' | 'emerald' | 'amber' | 'blue' | 'violet' | 'cyan' | 'orange' | 'fuchsia' | 'pink';

export const WORKFLOW_COLORS: SemanticColor[] = [
    'zinc',
    'indigo',
    'rose',
    'emerald',
    'amber',
    'blue',
    'violet',
    'cyan',
    'orange',
    'fuchsia',
    'pink'
];

type ColorMapping = {
    base: string;
    bg: string;
    border: string;
    dot: string;
    text: string;
};

export const COLOR_MAPPINGS: Record<SemanticColor, ColorMapping> = {
    zinc: {
        base: 'zinc',
        bg: 'bg-zinc-50 dark:bg-zinc-900/50',
        border: 'border-zinc-200 dark:border-zinc-800',
        dot: 'bg-zinc-500 dark:bg-zinc-400',
        text: 'text-zinc-900 dark:text-zinc-100',
    },
    indigo: {
        base: 'indigo',
        bg: 'bg-indigo-50/50 dark:bg-indigo-950/20',
        border: 'border-indigo-200/50 dark:border-indigo-900/50',
        dot: 'bg-indigo-500 dark:bg-indigo-400',
        text: 'text-indigo-900 dark:text-indigo-100',
    },
    rose: {
        base: 'rose',
        bg: 'bg-rose-50/50 dark:bg-rose-950/20',
        border: 'border-rose-200/50 dark:border-rose-900/50',
        dot: 'bg-rose-500 dark:bg-rose-400',
        text: 'text-rose-900 dark:text-rose-100',
    },
    emerald: {
        base: 'emerald',
        bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
        border: 'border-emerald-200/50 dark:border-emerald-900/50',
        dot: 'bg-emerald-500 dark:bg-emerald-400',
        text: 'text-emerald-900 dark:text-emerald-100',
    },
    amber: {
        base: 'amber',
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        border: 'border-amber-200/50 dark:border-amber-900/50',
        dot: 'bg-amber-500 dark:bg-amber-400',
        text: 'text-amber-900 dark:text-amber-100',
    },
    blue: {
        base: 'blue',
        bg: 'bg-blue-50/50 dark:bg-blue-950/20',
        border: 'border-blue-200/50 dark:border-blue-900/50',
        dot: 'bg-blue-500 dark:bg-blue-400',
        text: 'text-blue-900 dark:text-blue-100',
    },
    violet: {
        base: 'violet',
        bg: 'bg-violet-50/50 dark:bg-violet-950/20',
        border: 'border-violet-200/50 dark:border-violet-900/50',
        dot: 'bg-violet-500 dark:bg-violet-400',
        text: 'text-violet-900 dark:text-violet-100',
    },
    cyan: {
        base: 'cyan',
        bg: 'bg-cyan-50/50 dark:bg-cyan-950/20',
        border: 'border-cyan-200/50 dark:border-cyan-900/50',
        dot: 'bg-cyan-500 dark:bg-cyan-400',
        text: 'text-cyan-900 dark:text-cyan-100',
    },
    orange: {
        base: 'orange',
        bg: 'bg-orange-50/50 dark:bg-orange-950/20',
        border: 'border-orange-200/50 dark:border-orange-900/50',
        dot: 'bg-orange-500 dark:bg-orange-400',
        text: 'text-orange-900 dark:text-orange-100',
    },
    fuchsia: {
        base: 'fuchsia',
        bg: 'bg-fuchsia-50/50 dark:bg-fuchsia-950/20',
        border: 'border-fuchsia-200/50 dark:border-fuchsia-900/50',
        dot: 'bg-fuchsia-500 dark:bg-fuchsia-400',
        text: 'text-fuchsia-900 dark:text-fuchsia-100',
    },
    pink: {
        base: 'pink',
        bg: 'bg-pink-50/50 dark:bg-pink-950/20',
        border: 'border-pink-200/50 dark:border-pink-900/50',
        dot: 'bg-pink-500 dark:bg-pink-400',
        text: 'text-pink-900 dark:text-pink-100',
    }
};

export function parseSemanticColor(accentClass: string | null | undefined): SemanticColor {
    if (!accentClass) return 'zinc';
    
    // Legacy support for "bg-rose-500" or raw string formats
    const lower = accentClass.toLowerCase();
    for (const color of WORKFLOW_COLORS) {
        if (lower.includes(color)) return color;
    }
    
    return 'zinc'; // fallback
}

export function getColumnColors(accentClass: string | null | undefined): ColorMapping {
    const semantic = parseSemanticColor(accentClass);
    return COLOR_MAPPINGS[semantic];
}
