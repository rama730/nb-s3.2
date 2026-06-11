// Project ID and Slug utilities

/**
 * Generate a URL-friendly slug from a title
 */
export function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Remove consecutive hyphens
        .substring(0, 50); // Limit length
}

/**
 * Generate a unique project ID from title + cryptographically secure random suffix
 */
export function generateProjectId(title: string): string {
    const slug = generateSlug(title);
    const array = new Uint8Array(4);
    crypto.getRandomValues(array);
    const suffix = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${slug}-${suffix}`;
}
