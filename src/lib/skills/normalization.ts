const PUNCTUATION_TOKENS: ReadonlyArray<[RegExp, string]> = [
    [/\+/g, ' plus '],
    [/#/g, ' sharp '],
    [/&/g, ' and '],
    [/@/g, ' at '],
]

export function normalizeSkillLookup(value: string): string {
    let normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    for (const [pattern, replacement] of PUNCTUATION_TOKENS) {
        normalized = normalized.replace(pattern, replacement)
    }

    return normalized
        .replace(/[._/\\-]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function skillSlug(value: string): string {
    const normalized = normalizeSkillLookup(value)
    return normalized
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export function normalizeSkillInputList(values: readonly string[], maxItems = 25): string[] {
    const seen = new Set<string>()
    const output: string[] = []

    for (const raw of values) {
        if (typeof raw !== 'string') continue
        const display = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80)
        const lookup = normalizeSkillLookup(display)
        if (!display || !lookup || seen.has(lookup)) continue
        seen.add(lookup)
        output.push(display)
        if (output.length >= maxItems) break
    }

    return output
}

export function skillMonogram(value: string): string {
    const parts = value
        .normalize('NFKC')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase('en-US')
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toLocaleUpperCase('en-US')
}
