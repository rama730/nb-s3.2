export function generateSlugBase(title: string): string {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50);
}

export function generateSlug(title: string): string {
    const baseSlug = generateSlugBase(title);
    const suffix = Math.random().toString(36).substring(2, 7); // 5 char random string
    return `${baseSlug}-${suffix}`;
}
