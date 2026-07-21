// Project ID and Slug utilities

import { generateSlugBase } from '@/lib/utils/slug';

export { generateSlugBase as generateSlug } from '@/lib/utils/slug';

/**
 * Generate a unique project ID from title + cryptographically secure random suffix
 */
export function generateProjectId(title: string): string {
    const slug = generateSlugBase(title);
    const array = new Uint8Array(4);
    crypto.getRandomValues(array);
    const suffix = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${slug}-${suffix}`;
}
