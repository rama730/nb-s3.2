import { findCatalogSkill, SKILL_RELATIONSHIP_PAIRS } from './catalog'
import { normalizeSkillLookup } from './normalization'

const relationIndex = new Map<string, number>()
for (const [left, right, , weight] of SKILL_RELATIONSHIP_PAIRS) {
    const leftSkill = findCatalogSkill(left)
    const rightSkill = findCatalogSkill(right)
    if (!leftSkill || !rightSkill) continue
    relationIndex.set(`${leftSkill.canonicalKey}|${rightSkill.canonicalKey}`, weight / 100)
    relationIndex.set(`${rightSkill.canonicalKey}|${leftSkill.canonicalKey}`, weight / 100)
}

export function canonicalSkillKey(value: string): string {
    return findCatalogSkill(value)?.canonicalKey ?? `custom.${normalizeSkillLookup(value)}`
}

export function skillMatchScore(left: string, right: string): number {
    const leftKey = canonicalSkillKey(left)
    const rightKey = canonicalSkillKey(right)
    if (leftKey === rightKey) return 1
    return relationIndex.get(`${leftKey}|${rightKey}`) ?? 0
}

export function matchingSkillLabels(candidateSkills: readonly string[], requiredSkills: readonly string[], minimumScore = 1): string[] {
    return candidateSkills.filter((candidate) => requiredSkills.some((required) => skillMatchScore(candidate, required) >= minimumScore))
}

export function countCanonicalSkillMatches(values: readonly string[] | null, terms: readonly string[]): number {
    if (!values || values.length === 0 || terms.length === 0) return 0
    let count = 0
    for (const term of terms) {
        if (values.some((value) => skillMatchScore(value, term) === 1)) count += 1
    }
    return count
}

export function canonicalizeSkillLabels(values: readonly string[], maxItems = 25): string[] {
    const output: string[] = []
    const seen = new Set<string>()
    for (const value of values) {
        const display = value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (!display) continue
        const key = canonicalSkillKey(display)
        if (seen.has(key)) continue
        seen.add(key)
        output.push(findCatalogSkill(display)?.name ?? display)
        if (output.length >= maxItems) break
    }
    return output
}
