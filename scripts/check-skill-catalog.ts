import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { MARKET_SKILLS, SKILL_CATALOG_VERSION, SKILL_CATEGORIES } from '../src/lib/skills/catalog'
import { SKILL_ICON_MANIFEST, SKILL_ICON_MANIFEST_HASH, SKILL_ICON_MANIFEST_VERSION } from '../src/lib/skills/generated-icon-manifest'
import { SKILL_ICON_SOURCE_REGISTRY } from '../src/lib/skills/icon-sources'
import { SKILL_ICON_THEME_VARIANTS, SKILL_SEMANTIC_ICON_ONLY } from '../src/lib/skills/icon-theme-policy'
import { SKILL_CLIENT_CATALOG_VERSION } from '../src/lib/skills/generated-client-catalog'
import { normalizeSkillLookup } from '../src/lib/skills/normalization'
import { SKILL_SEMANTIC_ICON_KEYS } from '../src/lib/skills/semantic-icons'
import { hasExplicitCanvasBackground } from './skill-icons/normalize-svg'

const failures: string[] = []

if (SKILL_ICON_MANIFEST_VERSION !== SKILL_CATALOG_VERSION) failures.push('icon manifest catalog version is stale')
if (SKILL_CLIENT_CATALOG_VERSION !== SKILL_CATALOG_VERSION) failures.push('client catalog version is stale')

function assertUnique(label: string, values: readonly string[]) {
    const seen = new Map<string, number>()
    for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1)
    for (const [value, count] of seen) {
        if (count > 1) failures.push(`${label} is duplicated: ${value} (${count})`)
    }
}

async function main() {
assertUnique('category key', SKILL_CATEGORIES.map((category) => category.key))
assertUnique('canonical key', MARKET_SKILLS.map((skill) => skill.canonicalKey))
assertUnique('skill slug', MARKET_SKILLS.map((skill) => skill.slug))
assertUnique('preferred skill name', MARKET_SKILLS.map((skill) => normalizeSkillLookup(skill.name)))
assertUnique('audited icon source', SKILL_ICON_SOURCE_REGISTRY.map((source) => source.id))

const requiredIconSources = new Set([
    'simple-icons', 'devicon', 'skill-icons', 'iconic', 'profile-technology-icons',
    'logos', 'geticon', 'developer-icons', 'thesvg',
])
for (const source of SKILL_ICON_SOURCE_REGISTRY) {
    requiredIconSources.delete(source.id)
    if (!source.auditedCommit || source.auditedCommit.length !== 40) failures.push(`${source.id} has no pinned audited commit`)
    if (source.integration !== 'discovery-only' && !source.license) failures.push(`${source.id} is integrated without a declared license`)
    if (source.integration === 'package' && (!source.packageName || !source.packageVersion)) {
        failures.push(`${source.id} package integration is not pinned`)
    }
}
if (requiredIconSources.size > 0) failures.push(`icon-source audit is missing: ${[...requiredIconSources].join(', ')}`)

const aliasOwners = new Map<string, string>()
for (const skill of MARKET_SKILLS) {
    for (const label of [skill.name, ...skill.aliases]) {
        const normalized = normalizeSkillLookup(label)
        const owner = aliasOwners.get(normalized)
        if (owner && owner !== skill.canonicalKey) failures.push(`alias ${label} belongs to both ${owner} and ${skill.canonicalKey}`)
        else aliasOwners.set(normalized, skill.canonicalKey)
    }
}

const categoryKeys = new Set(SKILL_CATEGORIES.map((category) => category.key))
const semanticIconKeys = new Set<string>(SKILL_SEMANTIC_ICON_KEYS)
for (const skill of MARKET_SKILLS) {
    if (!categoryKeys.has(skill.categoryKey)) failures.push(`${skill.canonicalKey} references unknown category ${skill.categoryKey}`)
    if (!skill.name.trim()) failures.push(`${skill.canonicalKey} has an empty name`)
    if (!skill.slug.trim()) failures.push(`${skill.canonicalKey} has an empty slug`)
    if (skill.iconSource === 'lucide' && !semanticIconKeys.has(skill.iconKey)) {
        failures.push(`${skill.canonicalKey} references unsupported semantic icon ${skill.iconKey}`)
    }
}

const punctuationIdentities = ['C', 'C++', 'C#', 'F#', '.NET MAUI']
const punctuationSlugs = MARKET_SKILLS
    .filter((skill) => punctuationIdentities.includes(skill.name))
    .map((skill) => skill.slug)
assertUnique('punctuation-sensitive skill slug', punctuationSlugs)
if (punctuationSlugs.length !== punctuationIdentities.length) {
    failures.push('punctuation-sensitive identity fixture is incomplete')
}

const manifestHash = createHash('sha256').update(JSON.stringify(SKILL_ICON_MANIFEST)).digest('hex')
if (manifestHash !== SKILL_ICON_MANIFEST_HASH) failures.push('generated icon manifest hash does not match its contents')

type ManifestIcon = (typeof SKILL_ICON_MANIFEST)[keyof typeof SKILL_ICON_MANIFEST]
const manifestByCanonicalKey: Readonly<Record<string, ManifestIcon>> = SKILL_ICON_MANIFEST
const manifestAssetKeys = new Set<string>(Object.values(SKILL_ICON_MANIFEST).map((icon) => icon.assetKey))
for (const [assetKey, variant] of Object.entries(SKILL_ICON_THEME_VARIANTS)) {
    if (!manifestAssetKeys.has(assetKey)) failures.push(`theme-variant policy references unused icon asset ${assetKey}`)
    if (!/^#[0-9a-f]{6}$/i.test(variant.lightColor) || !/^#[0-9a-f]{6}$/i.test(variant.darkColor)) {
        failures.push(`theme-variant policy has invalid colors for ${assetKey}`)
    }
}
for (const name of SKILL_SEMANTIC_ICON_ONLY) {
    const skill = MARKET_SKILLS.find((entry) => entry.name === name)
    if (!skill) failures.push(`semantic-only skill is missing: ${name}`)
    else if (skill.canonicalKey in SKILL_ICON_MANIFEST) failures.push(`semantic-only skill has a brand asset: ${name}`)
}

function isUnsafeSvg(svg: string): boolean {
    if (/<(script|foreignObject|image|iframe|object|embed|style|a)\b|\son(?:click|load|error|mouse|pointer|key|touch|focus|blur|change|input|submit|animation|transition|drag|drop|scroll|wheel|play|pause)[\w:-]*\s*=|\ssrc\s*=/i.test(svg)) return true
    if ([...svg.matchAll(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].some((match) => !/^#[\w:.-]+$/.test(match[1] ?? match[2] ?? ''))) return true
    return [...svg.matchAll(/url\(([^)]+)\)/gi)].some((match) => !/^['\"]?#[\w:.-]+['\"]?$/.test(match[1]?.trim() ?? ''))
}

function isSingleSvgDocument(svg: string): boolean {
    const normalized = svg
        .replace(/<\?xml[^>]*>/gi, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim()
    return /^<svg\b/i.test(normalized)
        && /<\/svg>$/i.test(normalized)
        && (normalized.match(/<svg\b/gi)?.length ?? 0) === 1
        && (normalized.match(/<\/svg>/gi)?.length ?? 0) === 1
}
for (const [canonicalKey, icon] of Object.entries(SKILL_ICON_MANIFEST)) {
    if (!MARKET_SKILLS.some((skill) => skill.canonicalKey === canonicalKey)) {
        failures.push(`icon manifest references unknown skill ${canonicalKey}`)
    }
    const absolutePath = path.join(process.cwd(), 'public', icon.assetPath.replace(/^\/+/, '').replace(/^skill-icons\//, 'skill-icons/'))
    try {
        const asset = await readFile(absolutePath)
        const checksum = createHash('sha256').update(asset).digest('hex')
        if (checksum !== icon.checksum) failures.push(`${canonicalKey} icon checksum mismatch`)
        if (absolutePath.endsWith('.svg')) {
            const svg = asset.toString('utf8')
            if (!isSingleSvgDocument(svg)) failures.push(`${canonicalKey} icon is not one complete SVG document`)
            if (isUnsafeSvg(svg)) failures.push(`${canonicalKey} icon contains unsafe SVG content`)
            if (!/<(path|polygon|polyline|circle|rect|ellipse)\b/i.test(svg)) failures.push(`${canonicalKey} icon has no supported shape`)
            if (hasExplicitCanvasBackground(svg)) failures.push(`${canonicalKey} icon still contains a viewBox-sized canvas background`)
            try {
                await sharp(asset).resize(32, 32, { fit: 'contain' }).ensureAlpha().raw().toBuffer()
            } catch {
                failures.push(`${canonicalKey} icon cannot be rendered as a valid SVG`)
            }
        } else if (absolutePath.endsWith('.jpg')) {
            if (asset.length < 4 || asset[0] !== 0xff || asset[1] !== 0xd8 || asset.at(-2) !== 0xff || asset.at(-1) !== 0xd9) {
                failures.push(`${canonicalKey} icon is not a valid JPEG asset`)
            }
        } else if (absolutePath.endsWith('.png')) {
            const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
            if (asset.length < signature.length || !signature.every((value, index) => asset[index] === value)) {
                failures.push(`${canonicalKey} icon is not a valid PNG asset`)
            } else {
                try {
                    await sharp(asset).resize(32, 32, { fit: 'contain' }).ensureAlpha().raw().toBuffer()
                } catch {
                    failures.push(`${canonicalKey} icon cannot be rendered as a valid PNG`)
                }
            }
        } else {
            failures.push(`${canonicalKey} icon uses an unsupported asset format`)
        }
    } catch {
        failures.push(`${canonicalKey} icon asset is missing: ${absolutePath}`)
    }
}

if (MARKET_SKILLS.length < 1100) failures.push(`catalog coverage dropped below 1100 skills (${MARKET_SKILLS.length})`)
if (SKILL_CATEGORIES.length < 24) failures.push(`catalog category coverage dropped below 24 (${SKILL_CATEGORIES.length})`)
if (Object.keys(SKILL_ICON_MANIFEST).length < 740) failures.push(`branded icon coverage dropped below 740 (${Object.keys(SKILL_ICON_MANIFEST).length})`)

const requiredBrandedSkills = [
    'Adobe Illustrator', 'Adobe Photoshop', 'Adobe Premiere Pro', 'Adobe XD',
    'Adobe Audition', 'Adobe Express', 'Adobe Firefly', 'Adobe Commerce',
    'Amazon Aurora', 'Amazon DynamoDB', 'Amazon Redshift',
    'Apache Beam', 'Great Expectations', 'IBM Db2', 'Amazon Bedrock',
    'Google Vertex AI', 'Groq', 'Amazon RDS', 'Amazon Web Services', 'AWS Lambda',
    'Adobe After Effects', 'TestFlight', 'Codex', 'Google Antigravity',
    'LangSmith', 'Langfuse', 'Amazon Q Developer', 'Linux', 'macOS',
    'Fivetran', 'Adobe Analytics', 'gRPC', 'GeoServer', 'PostGIS', 'AutoGen',
    'Claude', 'Claude Code',
] as const
for (const name of requiredBrandedSkills) {
    const skill = MARKET_SKILLS.find((entry) => entry.name === name)
    if (!skill) failures.push(`required branded skill is missing: ${name}`)
    else if (!(skill.canonicalKey in SKILL_ICON_MANIFEST)) failures.push(`required branded icon is missing: ${name}`)
}

for (const name of ['SolidJS', 'MATLAB', 'PowerShell'] as const) {
    const skill = MARKET_SKILLS.find((entry) => entry.name === name)
    const icon = skill ? manifestByCanonicalKey[skill.canonicalKey] : undefined
    if (!icon || icon.source !== 'devicon' || !/-original\.svg$/.test(icon.sourceUrl)) {
        failures.push(`${name} does not use the multicolor Devicon original`)
    }
}

if (failures.length > 0) {
    console.error('[skills] Catalog validation failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
} else {
    console.log(`[skills] Catalog valid: ${MARKET_SKILLS.length} skills, ${SKILL_CATEGORIES.length} categories, ${Object.keys(SKILL_ICON_MANIFEST).length} branded icons.`)
}
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
