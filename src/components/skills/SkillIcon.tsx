import { memo } from 'react'
import { cn } from '@/lib/utils'
import { GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS } from '@/lib/skills/generated-icon-theme-variants'
import { resolveSkillIconThemeVariant } from '@/lib/skills/icon-theme-policy'
import { skillMonogram } from '@/lib/skills/normalization'
import type { SkillSummary } from '@/lib/skills/types'

const IDENTITY_FALLBACK_KINDS = new Set<SkillSummary['kind']>([
    'language', 'framework', 'library', 'tool', 'platform', 'database',
])

const SPRITE_VERSION = '1.3.6'
const SPRITE_UNSAFE_LOCAL_IMAGE_KEYS = new Set(['curated-google-antigravity'])

function assetFilename(iconKey: string): string {
    return /\.(?:svg|png|jpe?g|webp)$/i.test(iconKey) ? iconKey : `${iconKey}.svg`
}

export const SkillIcon = memo(function SkillIcon({
    skill,
    size = 16,
    className,
    colorMode = 'brand',
    decorative = true,
}: {
    skill: SkillSummary
    size?: number
    className?: string
    colorMode?: 'brand' | 'current'
    decorative?: boolean
}) {
    const labelProps = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': skill.name }

    // 1. Monogram Fallbacks (Concepts/Competencies or Identity fallback kinds without keys)
    if (skill.iconSource === 'monogram' || (skill.iconSource === 'lucide' && IDENTITY_FALLBACK_KINDS.has(skill.kind))) {
        return (
            <span
                {...labelProps}
                className={cn('inline-flex shrink-0 items-center justify-center rounded-[4px] bg-zinc-200 font-semibold leading-none text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100', className)}
                style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.43)) }}
            >
                {skillMonogram(skill.name)}
            </span>
        )
    }

    // 2. Lucide Icons (Rendered via sprite symbols)
    if (skill.iconSource === 'lucide') {
        const fallbackKey = skill.iconKey ?? 'badge'
        return (
            <svg
                {...labelProps}
                width={size}
                height={size}
                className={cn('inline-block shrink-0 text-current fill-none stroke-current', className)}
                style={{ strokeWidth: 1.8 }}
            >
                <use href={`/skill-sprites.svg?v=${SPRITE_VERSION}#skill-lucide-${fallbackKey}`} />
            </svg>
        )
    }

    // 3. Branded & Curated Icons (Rendered via sprite symbols)
    if (skill.iconKey) {
        // Theme variants (e.g. logos-anthropic-icon / logos-openai-icon, light vs dark assets)
        const assetVariant = colorMode === 'brand'
            ? GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS[skill.iconKey as keyof typeof GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS]
            : undefined

        if (assetVariant) {
            return (
                <span {...labelProps} className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
                    <svg width={size} height={size} className="absolute inset-0 dark:hidden" style={{ fill: 'currentColor' }} aria-hidden="true">
                        <use href={`/skill-sprites.svg?v=${SPRITE_VERSION}#skill-${assetVariant.lightIconKey}`} />
                    </svg>
                    <svg width={size} height={size} className="absolute inset-0 hidden dark:block" style={{ fill: 'currentColor' }} aria-hidden="true">
                        <use href={`/skill-sprites.svg?v=${SPRITE_VERSION}#skill-${assetVariant.darkIconKey}`} />
                    </svg>
                </span>
            )
        }

        // Custom light/dark colors (simple-icons and overrides)
        const themeVariant = colorMode === 'brand'
            ? resolveSkillIconThemeVariant(skill)
            : undefined

        if (themeVariant) {
            return (
                <span {...labelProps} className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
                    <svg
                        width={size}
                        height={size}
                        className="absolute inset-0 dark:hidden"
                        style={{ fill: themeVariant.lightColor }}
                        aria-hidden="true"
                    >
                        <use href={`/skill-sprites.svg?v=${SPRITE_VERSION}#skill-${skill.iconKey}`} />
                    </svg>
                    <svg
                        width={size}
                        height={size}
                        className="absolute inset-0 hidden dark:block"
                        style={{ fill: themeVariant.darkColor }}
                        aria-hidden="true"
                    >
                        <use href={`/skill-sprites.svg?v=${SPRITE_VERSION}#skill-${skill.iconKey}`} />
                    </svg>
                </span>
            )
        }

        // Single brand color or currentColor fallback
        const useBrandColor = colorMode === 'brand' && Boolean(skill.brandColor)
        const useLocalImage = skill.iconSource === 'custom' && (
            SPRITE_UNSAFE_LOCAL_IMAGE_KEYS.has(skill.iconKey)
            || /\.(?:png|jpe?g|webp)$/i.test(skill.iconKey)
        )

        // Safari can lose SVG defs/gradients for a few custom icons when they render through an external sprite <use>.
        if (useLocalImage) {
            return (
                <span
                    {...labelProps}
                    className={cn('inline-block shrink-0 bg-center bg-no-repeat', className)}
                    style={{
                        width: size,
                        height: size,
                        backgroundImage: `url(/skill-icons/v1/${assetFilename(skill.iconKey)})`,
                        backgroundSize: 'contain',
                    }}
                />
            )
        }

        return (
            <svg
                {...labelProps}
                width={size}
                height={size}
                className={cn('inline-block shrink-0', className)}
                style={useBrandColor ? { fill: skill.brandColor! } : { fill: 'currentColor' }}
            >
                <use href={`/skill-sprites.svg?v=${SPRITE_VERSION}#skill-${skill.iconKey}`} />
            </svg>
        )
    }

    // Ultimate fallback badge
    return (
        <span
            {...labelProps}
            className={cn('inline-flex shrink-0 items-center justify-center rounded-[4px] bg-zinc-200 font-semibold leading-none text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100', className)}
            style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.43)) }}
        >
            {skillMonogram(skill.name)}
        </span>
    )
})
