import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { MARKET_SKILLS } from '../src/lib/skills/catalog'
import { resolveClientSkill } from '../src/lib/skills/client'
import { GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS } from '../src/lib/skills/generated-icon-theme-variants'
import { resolveSkillIconThemeVariant } from '../src/lib/skills/icon-theme-policy'
import { SKILL_SEMANTIC_ICON_KEYS } from '../src/lib/skills/semantic-icons'
import type { SkillSummary } from '../src/lib/skills/types'

const LIGHT_BACKGROUND = '#FFFFFF'
const DARK_BACKGROUND = '#09090B'
const ICON_SIZE = 48
// Skill marks are identity artwork, not text. This gate detects effectively
// invisible exports and theme collisions; it is deliberately not presented as
// a WCAG text-contrast threshold.
const DARK_CONTRAST_FLOOR = 1.15
const DARK_VISIBLE_PIXEL_FLOOR = 0.02

type Theme = 'light' | 'dark'
type VisibilityResult = {
    theme: Theme
    opaquePixels: number
    visiblePixels: number
    visibleFraction: number
    averageContrast: number
    pass: boolean
}

type AuditEntry = {
    canonicalKey: string
    name: string
    categoryKey: string
    iconSource: SkillSummary['iconSource']
    iconKey: string
    light: VisibilityResult
    dark: VisibilityResult
}

type FallbackAuditEntry = {
    canonicalKey: string
    name: string
    categoryKey: string
    iconSource: 'lucide' | 'monogram'
    iconKey: string
    strategy: 'semantic-current-color' | 'theme-token-monogram'
    pass: boolean
}

function hexRgb(hex: string): [number, number, number] {
    const normalized = hex.replace('#', '')
    if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid color: ${hex}`)
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number]
}

function luminance(red: number, green: number, blue: number): number {
    const linearize = (channel: number) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    const r = linearize(red)
    const g = linearize(green)
    const b = linearize(blue)
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
}

function contrast(left: [number, number, number], right: [number, number, number]): number {
    const first = luminance(...left)
    const second = luminance(...right)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

async function colorizedMask(asset: Buffer, color: string): Promise<Buffer> {
    const alpha = await sharp(asset)
        .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain' })
        .ensureAlpha()
        .extractChannel(3)
        .raw()
        .toBuffer()
    return sharp({ create: { width: ICON_SIZE, height: ICON_SIZE, channels: 3, background: color } })
        .joinChannel(alpha, { raw: { width: ICON_SIZE, height: ICON_SIZE, channels: 1 } })
        .raw()
        .toBuffer()
}

async function nativePixels(asset: Buffer): Promise<Buffer> {
    return sharp(asset)
        .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain' })
        .ensureAlpha()
        .raw()
        .toBuffer()
}

function assetFile(skill: SkillSummary, iconKey = skill.iconKey): string {
    const filename = /\.(?:svg|png|jpe?g|webp)$/i.test(iconKey)
        ? iconKey
        : `${iconKey}.svg`
    return path.join(process.cwd(), 'public', 'skill-icons', 'v1', filename)
}

async function pixelsFor(skill: SkillSummary, theme: Theme): Promise<Buffer> {
    const assetVariant = GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS[skill.iconKey as keyof typeof GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS]
    const effectiveIconKey = assetVariant
        ? (theme === 'dark' ? assetVariant.darkIconKey : assetVariant.lightIconKey)
        : skill.iconKey
    const asset = await readFile(assetFile(skill, effectiveIconKey))
    const variant = resolveSkillIconThemeVariant(skill)
    if (variant) return colorizedMask(asset, theme === 'dark' ? variant.darkColor : variant.lightColor)
    if (skill.iconSource === 'simple-icons') {
        return colorizedMask(asset, skill.brandColor ?? (theme === 'dark' ? '#FFFFFF' : '#111111'))
    }
    return nativePixels(asset)
}

function inspectPixels(pixels: Buffer, theme: Theme): VisibilityResult {
    const background = hexRgb(theme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND)
    let opaquePixels = 0
    let visiblePixels = 0
    let contrastTotal = 0
    for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3]! / 255
        if (alpha < 0.08) continue
        opaquePixels += 1
        const composited: [number, number, number] = [0, 1, 2].map((channel) => (
            Math.round((pixels[index + channel]! * alpha) + (background[channel]! * (1 - alpha)))
        )) as [number, number, number]
        const ratio = contrast(composited, background)
        contrastTotal += ratio
        if (ratio >= DARK_CONTRAST_FLOOR) visiblePixels += 1
    }
    const visibleFraction = opaquePixels === 0 ? 0 : visiblePixels / opaquePixels
    const averageContrast = opaquePixels === 0 ? 0 : contrastTotal / opaquePixels
    return {
        theme,
        opaquePixels,
        visiblePixels,
        visibleFraction: Number(visibleFraction.toFixed(4)),
        averageContrast: Number(averageContrast.toFixed(4)),
        pass: opaquePixels > 0 && (theme === 'light' || (
            visibleFraction >= DARK_VISIBLE_PIXEL_FLOOR
            && averageContrast >= DARK_CONTRAST_FLOOR
        )),
    }
}

async function main() {
    const entries: AuditEntry[] = []
    const fallbacks: FallbackAuditEntry[] = []
    const failures: string[] = []
    const audited = new Map<string, { light: VisibilityResult; dark: VisibilityResult }>()
    const semanticIconKeys = new Set<string>(SKILL_SEMANTIC_ICON_KEYS)
    const rendererSource = await readFile(path.join(process.cwd(), 'src', 'components', 'skills', 'SkillIcon.tsx'), 'utf8')
    const monogramThemeTokensPresent = /dark:bg-zinc-700/.test(rendererSource) && /dark:text-zinc-100/.test(rendererSource)

    for (const definition of MARKET_SKILLS) {
        const skill = resolveClientSkill(definition.name)
        if (skill.iconSource === 'lucide' || skill.iconSource === 'monogram') {
            const pass = skill.iconSource === 'lucide'
                ? semanticIconKeys.has(skill.iconKey)
                : monogramThemeTokensPresent
            fallbacks.push({
                canonicalKey: skill.canonicalKey,
                name: skill.name,
                categoryKey: skill.categoryKey,
                iconSource: skill.iconSource,
                iconKey: skill.iconKey,
                strategy: skill.iconSource === 'lucide' ? 'semantic-current-color' : 'theme-token-monogram',
                pass,
            })
            if (!pass) failures.push(`${skill.name} (${skill.iconKey}): theme-readable fallback contract failed`)
            continue
        }
        const identity = [skill.iconSource, skill.iconKey, skill.brandColor ?? ''].join(':')
        let result = audited.get(identity)
        if (!result) {
            const [lightPixels, darkPixels] = await Promise.all([
                pixelsFor(skill, 'light'),
                pixelsFor(skill, 'dark'),
            ])
            result = {
                light: inspectPixels(lightPixels, 'light'),
                dark: inspectPixels(darkPixels, 'dark'),
            }
            audited.set(identity, result)
        }
        const entry = {
            canonicalKey: skill.canonicalKey,
            name: skill.name,
            categoryKey: skill.categoryKey,
            iconSource: skill.iconSource,
            iconKey: skill.iconKey,
            ...result,
        }
        entries.push(entry)
        if (!entry.light.pass || !entry.dark.pass) {
            failures.push(`${entry.name} (${entry.iconKey}): light=${entry.light.averageContrast}/${entry.light.visibleFraction}, dark=${entry.dark.averageContrast}/${entry.dark.visibleFraction}`)
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        policy: {
            lightBackground: LIGHT_BACKGROUND,
            darkBackground: DARK_BACKGROUND,
            darkContrastFloor: DARK_CONTRAST_FLOOR,
            darkVisiblePixelFloor: DARK_VISIBLE_PIXEL_FLOOR,
            lightPolicy: 'non-empty-alpha',
        },
        totals: {
            catalogSkills: MARKET_SKILLS.length,
            brandedSkills: entries.length,
            uniqueBrandedRenders: audited.size,
            fallbackSkills: fallbacks.length,
            auditedSkills: entries.length + fallbacks.length,
            passing: entries.length + fallbacks.length - failures.length,
            failing: failures.length,
        },
        failures,
        entries,
        fallbacks,
    }
    await mkdir(path.join(process.cwd(), 'artifacts'), { recursive: true })
    await writeFile(
        path.join(process.cwd(), 'artifacts', 'skill-icon-visibility-audit.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
    )

    if (failures.length > 0) {
        console.error(`[skills] ${failures.length} branded skill renders failed visibility audit:`)
        failures.forEach((failure) => console.error(`- ${failure}`))
        process.exitCode = 1
    } else {
        console.log(`[skills] Visibility valid for all ${entries.length + fallbacks.length} catalog skills: ${entries.length} branded renders (${audited.size} unique) and ${fallbacks.length} theme-token fallbacks.`)
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
