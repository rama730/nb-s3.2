export function generateSlug(title: string): string {
    const baseSlug = title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const suffix = Math.random().toString(36).substring(2, 7); // 5 char random string
    return `${baseSlug}-${suffix}`;
}
