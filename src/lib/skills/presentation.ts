import { SKILL_ICON_MANIFEST } from './generated-icon-manifest'
import type { MarketSkillDefinition, SkillSummary } from './types'

type GeneratedIconDescriptor = (typeof SKILL_ICON_MANIFEST)[keyof typeof SKILL_ICON_MANIFEST]

export function getGeneratedSkillIcon(canonicalKey: string): GeneratedIconDescriptor | null {
    const manifest = SKILL_ICON_MANIFEST as Readonly<Record<string, GeneratedIconDescriptor>>
    return manifest[canonicalKey] ?? null
}

export function toSkillSummary(skill: MarketSkillDefinition): SkillSummary {
    const generatedIcon = getGeneratedSkillIcon(skill.canonicalKey)
    return {
        canonicalKey: skill.canonicalKey,
        name: skill.name,
        slug: skill.slug,
        categoryKey: skill.categoryKey,
        kind: skill.kind,
        marketTier: skill.marketTier,
        iconSource: generatedIcon?.source ?? skill.iconSource,
        iconKey: generatedIcon?.assetKey ?? skill.iconKey,
        brandColor: generatedIcon?.brandColor ?? skill.brandColor,
        status: 'active',
        replacementSkillId: null,
    }
}
