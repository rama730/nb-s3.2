/**
 * Client-side zero-dependency email domain typo heuristic.
 * Detects common domain misspellings (e.g., user@gmai.com -> user@gmail.com)
 * with zero network latency and minimal bundle overhead.
 */

const POPULAR_DOMAINS = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'live.com',
    'aol.com',
] as const

const KNOWN_TYPO_MAP: Record<string, string> = {
    // Gmail
    'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gmaik.com': 'gmail.com',
    'gmail.cm': 'gmail.com',
    'gmail.om': 'gmail.com',
    'gmaul.com': 'gmail.com',
    'gemail.com': 'gmail.com',

    // Yahoo
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'yhaoo.com': 'yahoo.com',
    'yahoo.co': 'yahoo.com',
    'yaho.co': 'yahoo.com',
    'uahoo.com': 'yahoo.com',

    // Hotmail
    'hotmial.com': 'hotmail.com',
    'hotmale.com': 'hotmail.com',
    'hotmaill.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com',
    'hitmail.com': 'hotmail.com',

    // Outlook
    'outlok.com': 'outlook.com',
    'outloo.com': 'outlook.com',
    'outlock.com': 'outlook.com',
    'outlook.co': 'outlook.com',
    'outllok.com': 'outlook.com',

    // iCloud
    'iclud.com': 'icloud.com',
    'icould.com': 'icloud.com',
    'icloud.co': 'icloud.com',
    'icoud.com': 'icloud.com',

    // Proton
    'protonmai.com': 'protonmail.com',
    'protonmaill.com': 'protonmail.com',
    'proton.cm': 'proton.me',
    'proton.co': 'proton.me',
}

function levenshteinDistance(a: string, b: string): number {
    const m = a.length
    const n = b.length
    if (Math.abs(m - n) > 2) return 99

    let prevRow: number[] = Array.from({ length: n + 1 }, (_, i) => i)
    const currRow: number[] = new Array<number>(n + 1).fill(0)

    for (let i = 1; i <= m; i++) {
        currRow[0] = i
        const aChar = a[i - 1]
        for (let j = 1; j <= n; j++) {
            const cost = aChar === b[j - 1] ? 0 : 1
            const deletion = (prevRow[j] ?? 0) + 1
            const insertion = (currRow[j - 1] ?? 0) + 1
            const substitution = (prevRow[j - 1] ?? 0) + cost
            currRow[j] = Math.min(deletion, insertion, substitution)
        }
        prevRow = [...currRow]
    }

    return prevRow[n] ?? 99
}

export type EmailTypoSuggestion = {
    hasTypo: boolean
    suggestedEmail: string | null
    correctedDomain: string | null
}

export function detectEmailDomainTypo(email: string): EmailTypoSuggestion {
    const trimmed = email.trim().toLowerCase()
    const atIndex = trimmed.lastIndexOf('@')

    if (atIndex <= 0 || atIndex === trimmed.length - 1) {
        return { hasTypo: false, suggestedEmail: null, correctedDomain: null }
    }

    const localPart = trimmed.slice(0, atIndex)
    const domain = trimmed.slice(atIndex + 1)

    // Exact match with popular domain -> no typo
    if (POPULAR_DOMAINS.includes(domain as (typeof POPULAR_DOMAINS)[number])) {
        return { hasTypo: false, suggestedEmail: null, correctedDomain: null }
    }

    // 1. Direct dictionary match
    if (KNOWN_TYPO_MAP[domain]) {
        const corrected = KNOWN_TYPO_MAP[domain]
        return {
            hasTypo: true,
            suggestedEmail: `${localPart}@${corrected}`,
            correctedDomain: corrected,
        }
    }

    // 2. Levenshtein edit distance check (distance === 1)
    for (const popular of POPULAR_DOMAINS) {
        if (levenshteinDistance(domain, popular) === 1) {
            return {
                hasTypo: true,
                suggestedEmail: `${localPart}@${popular}`,
                correctedDomain: popular,
            }
        }
    }

    return { hasTypo: false, suggestedEmail: null, correctedDomain: null }
}
