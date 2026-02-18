/**
 * Generate a URL-friendly base slug from a title.
 * Does not include a random suffix — use `generateUniqueSlug` for uniqueness.
 */
export function generateBaseSlug(title: string, maxLength = 50): string {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, maxLength);
}

/**
 * Generate a unique slug from a title by appending a random suffix.
 */
export function generateSlug(title: string): string {
    const baseSlug = generateBaseSlug(title);
    const suffix = Math.random().toString(36).substring(2, 8);
    return `${baseSlug}-${suffix}`;
}
