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
 * Generate a unique project ID from title + random suffix
 */
export function generateProjectId(title: string): string {
    const slug = generateSlug(title);
    const suffix = Math.random().toString(36).substring(2, 8);
    return `${slug}-${suffix}`;
}
