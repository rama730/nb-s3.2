import { DEFAULT_SKILL_CLIENT_KEYS, SKILL_CLIENT_LOOKUP } from './generated-client-catalog'
import { normalizeSkillLookup, skillMonogram, skillSlug } from './normalization'
import type { SkillSummary } from './types'

type ClientSkillTuple = readonly [string, string, string, string, string | null, string, string]
const lookup = SKILL_CLIENT_LOOKUP as Readonly<Record<string, ClientSkillTuple>>

export function resolveClientSkill(value: string): SkillSummary {
    const tuple = lookup[normalizeSkillLookup(value)]
    if (tuple) {
        return {
            canonicalKey: tuple[0],
            name: tuple[1],
            slug: skillSlug(tuple[1]),
            iconSource: tuple[2] as SkillSummary['iconSource'],
            iconKey: tuple[3],
            brandColor: tuple[4],
            categoryKey: tuple[5],
            kind: tuple[6] as SkillSummary['kind'],
            marketTier: 'core',
            status: 'active',
            replacementSkillId: null,
        }
    }

    const display = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    return {
        canonicalKey: `custom.${skillSlug(display) || skillMonogram(display).toLocaleLowerCase('en-US')}`,
        name: display,
        slug: skillSlug(display),
        iconSource: 'monogram',
        iconKey: 'badge',
        brandColor: null,
        categoryKey: 'human',
        kind: 'competency',
        marketTier: 'extended',
        status: 'pending',
        replacementSkillId: null,
    }
}

export const DEFAULT_CLIENT_SKILLS = DEFAULT_SKILL_CLIENT_KEYS.map((key) => resolveClientSkill(key))
