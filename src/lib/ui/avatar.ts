/**
 * C3: Single source of truth for avatar gradient selection.
 * All avatar fallback gradients and hash logic consolidated here.
 */

const AVATAR_GRADIENTS = [
    'from-violet-500 to-indigo-500',
    'from-blue-500 to-cyan-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-pink-500',
    'from-fuchsia-500 to-purple-500',
] as const;

/**
 * Returns a deterministic Tailwind gradient class pair for a given name.
 * Use with `bg-gradient-to-br ${getAvatarGradient(name)}`.
 */
export function getAvatarGradient(name: string): string {
    const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}
