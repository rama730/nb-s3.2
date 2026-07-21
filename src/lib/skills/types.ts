export const SKILL_KINDS = [
    'language',
    'framework',
    'library',
    'database',
    'platform',
    'tool',
    'protocol',
    'methodology',
    'competency',
    'domain',
] as const

export type SkillKind = (typeof SKILL_KINDS)[number]
export type SkillMarketTier = 'core' | 'extended' | 'reference'
export type SkillStatus = 'active' | 'deprecated' | 'merged' | 'hidden' | 'pending'
export type SkillIconSource =
    | 'simple-icons'
    | 'devicon'
    | 'skill-icons'
    | 'logos'
    | 'developer-icons'
    | 'lucide'
    | 'custom'
    | 'monogram'

export type SkillCategoryDefinition = {
    key: string
    name: string
    description: string
    iconKey: string
    displayOrder: number
}

export type MarketSkillDefinition = {
    canonicalKey: string
    name: string
    slug: string
    categoryKey: string
    kind: SkillKind
    marketTier: SkillMarketTier
    aliases: string[]
    iconSource: SkillIconSource
    iconKey: string
    brandColor: string | null
    description: string | null
}

export type SkillSummary = Pick<
    MarketSkillDefinition,
    | 'canonicalKey'
    | 'name'
    | 'slug'
    | 'categoryKey'
    | 'kind'
    | 'marketTier'
    | 'iconSource'
    | 'iconKey'
    | 'brandColor'
> & {
    id?: string
    status?: SkillStatus
    replacementSkillId?: string | null
}

export type SkillSearchResult = SkillSummary & {
    matchedAlias?: string | null
    score: number
}
