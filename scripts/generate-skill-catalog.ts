import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { icons as logosCollection } from '@iconify-json/logos'
import { icons as skillIconsCollection } from '@iconify-json/skill-icons'
import * as developerIcons from 'developer-icons'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as simpleIcons from 'simple-icons'
import * as LucideIcons from 'lucide-react'
import { DEFAULT_ONBOARDING_SKILLS, MARKET_SKILLS, SKILL_CATALOG_MIGRATION_TAG, SKILL_CATALOG_VERSION, SKILL_CATEGORIES, SKILL_DEVICON_OVERRIDES, SKILL_DEVICON_SOURCE_VERSION, SKILL_ICON_OVERRIDES, SKILL_ICON_SOURCE_VERSION } from '../src/lib/skills/catalog'
import { SKILL_DEVELOPER_ICON_OVERRIDES, SKILL_ICONIFY_OVERRIDES, SKILL_ICON_SOURCE_REGISTRY } from '../src/lib/skills/icon-sources'
import { SKILL_SEMANTIC_ICON_ONLY, SKILL_ICON_THEME_VARIANTS } from '../src/lib/skills/icon-theme-policy'
import { normalizeSkillLookup, skillSlug } from '../src/lib/skills/normalization'
import { normalizeTransparentSvg } from './skill-icons/normalize-svg'
type SimpleIcon = {
    title: string
    slug: string
    path: string
    svg: string
    hex: string
    source: string
    guidelines?: string
    license?: { type?: string; url?: string }
}

type DeviconIcon = {
    name: string
    altnames?: string[]
    versions: { svg?: string[] }
    color: string
}

type GeneratedBrandIcon = {
    source: 'simple-icons' | 'devicon' | 'skill-icons' | 'logos' | 'developer-icons' | 'custom'
    assetKey: string
    sourceSlug: string
    sourceVersion: string
    assetPath: string
    brandColor: string | null
    checksum: string
    sourceUrl: string
    guidelinesUrl: string | null
    licenseType: string | null
    licenseUrl: string | null
}

const root = process.cwd()
const assetDir = path.join(root, 'public', 'skill-icons', 'v1')
const manifestPath = path.join(root, 'src', 'lib', 'skills', 'generated-icon-manifest.ts')
const themeAssetVariantsPath = path.join(root, 'src', 'lib', 'skills', 'generated-icon-theme-variants.ts')
const clientCatalogPath = path.join(root, 'src', 'lib', 'skills', 'generated-client-catalog.ts')
const seedMigrationPath = path.join(root, 'drizzle', `${SKILL_CATALOG_MIGRATION_TAG}.sql`)
const deviconRoot = path.join(root, 'node_modules', 'devicon')
const curatedIconRoot = path.join(root, 'scripts', 'skill-icons', 'curated')

type IconifyCollection = {
    icons: Record<string, { body: string; width?: number; height?: number }>
    width?: number
    height?: number
}
type DeveloperIconComponent = ComponentType<{ size?: number }>

const PACKAGE_SOURCE_VERSIONS = Object.fromEntries(
    SKILL_ICON_SOURCE_REGISTRY
        .filter((source) => source.integration === 'package' && source.packageVersion)
        .map((source) => [source.id, source.packageVersion!]),
) as Record<string, string>

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

function cleanSvg(svg: string): string {
    const withoutMetadata = svg
        .replace(/<\?xml[^>]*>/gi, '')
        .replace(/<!--[^]*?-->/g, '')
        .trim()
    const cleaned = withoutMetadata.replace(/<svg\b[^>]*>/i, (rootTag) => (
        rootTag.replace(/\s(?:width|height|class|style)=(?:"[^"]*"|'[^']*')/gi, '')
    ))
    if (!isSingleSvgDocument(cleaned)) throw new Error('Icon asset is not one complete SVG document')
    if (isUnsafeSvg(cleaned)) throw new Error('Unsafe SVG content from an audited icon package')
    if (!/<(path|polygon|polyline|circle|rect|ellipse)\b/i.test(cleaned)) throw new Error('SVG contains no supported shape')
    return `${cleaned}\n`
}

function iconifySvg(collection: IconifyCollection, key: string): string | null {
    const icon = collection.icons[key as keyof typeof collection.icons]
    if (!icon) return null
    const width = icon.width ?? collection.width ?? 24
    const height = icon.height ?? collection.height ?? 24
    return cleanSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`)
}

function normalizedIconName(value: string): string {
    return normalizeSkillLookup(value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/(?:[-_ ](?:dark|light|icon|logo|wordmark|original|plain|outline|filled|color|colour|alt))+$/gi, ''))
}

function buildIconifyIndex(collection: IconifyCollection): Map<string, string> {
    const index = new Map<string, string>()
    const preference = (key: string) => (
        /-(?:icon|light)$/.test(key) ? 0
            : /-(?:dark|wordmark|logo)$/.test(key) ? 2
                : 1
    )
    for (const key of Object.keys(collection.icons).sort((left, right) => preference(left) - preference(right))) {
        for (const candidate of [normalizeSkillLookup(key), normalizedIconName(key)]) {
            if (candidate && !index.has(candidate)) index.set(candidate, key)
        }
    }
    return index
}

function buildDeveloperIconIndex(): Map<string, string> {
    const index = new Map<string, string>()
    const names = Object.keys(developerIcons)
        .filter((key) => typeof (developerIcons as Record<string, unknown>)[key] === 'function')
        .sort((left, right) => Number(/(?:Wordmark|Dark|Light)$/.test(left)) - Number(/(?:Wordmark|Dark|Light)$/.test(right)))
    for (const name of names) {
        const normalized = normalizedIconName(name)
        if (normalized && !index.has(normalized)) index.set(normalized, name)
    }
    return index
}

function developerIconSvg(name: string): string | null {
    const component = (developerIcons as Record<string, unknown>)[name] as DeveloperIconComponent | undefined
    if (!component) return null
    return cleanSvg(renderToStaticMarkup(createElement(component, { size: 64 })))
}

function iconifyBrandIcon(
    _skillName: string,
    source: 'skill-icons' | 'logos',
    key: string,
): Omit<GeneratedBrandIcon, 'assetPath' | 'checksum'> & { svg: string } | null {
    const collection = source === 'skill-icons' ? skillIconsCollection : logosCollection
    const svg = iconifySvg(collection, key)
    if (!svg) return null
    const sourceRecord = SKILL_ICON_SOURCE_REGISTRY.find((entry) => entry.id === source)!
    return {
        source,
        assetKey: `${source}-${skillSlug(key)}`,
        sourceSlug: key,
        sourceVersion: sourceRecord.packageVersion!,
        brandColor: null,
        sourceUrl: `${sourceRecord.repository}/tree/${sourceRecord.auditedCommit}/${source === 'skill-icons' ? 'icons' : 'logos'}`,
        guidelinesUrl: sourceRecord.repository,
        licenseType: sourceRecord.license,
        licenseUrl: `${sourceRecord.repository}/blob/${sourceRecord.auditedCommit}/${source === 'logos' ? 'LICENSE.txt' : 'LICENSE'}`,
        svg,
    }
}

async function writeGeneratedIcon(
    icon: Omit<GeneratedBrandIcon, 'assetPath' | 'checksum'> & { svg: string },
    writtenAssets: Set<string>,
    options: { removeFirstShape?: boolean; skipRecolor?: boolean } = {},
): Promise<GeneratedBrandIcon> {
    const transparent = normalizeTransparentSvg(cleanSvg(icon.svg), options)
    const normalizedIcon = {
        ...icon,
        svg: transparent.svg,
        brandColor: icon.brandColor ?? transparent.extractedBrandColor,
    }
    const filename = `${icon.assetKey}.svg`
    const checksum = createHash('sha256').update(normalizedIcon.svg).digest('hex')
    if (!writtenAssets.has(filename)) {
        await writeFile(path.join(assetDir, filename), normalizedIcon.svg, 'utf8')
        writtenAssets.add(filename)
    }
    const { svg: _svg, ...metadata } = normalizedIcon
    return { ...metadata, assetPath: `/skill-icons/v1/${filename}`, checksum }
}

const REMOVE_FIRST_CANVAS_SHAPE = new Set(['Adobe Premiere Pro', 'Adobe Audition'])

type CuratedIcon = {
    filename: string
    format?: 'svg' | 'base64-jpeg' | 'base64-png'
    viewBox?: string
    brandColor: string
    sourceUrl: string
    licenseType: string
    licenseUrl: string
}

const THESVG_COMMIT = 'e25d9e9c43c40f353a5b1c109c9d288d8a4fa16b'
const THESVG_LICENSE_URL = `https://github.com/glincker/thesvg/blob/${THESVG_COMMIT}/LICENSE`
function theSvgIcon(filename: string, sourcePath: string, brandColor: string): CuratedIcon {
    return {
        filename,
        brandColor,
        sourceUrl: `https://github.com/glincker/thesvg/blob/${THESVG_COMMIT}/${sourcePath}`,
        licenseType: 'MIT',
        licenseUrl: THESVG_LICENSE_URL,
    }
}

const CURATED_ICONS: Readonly<Record<string, CuratedIcon>> = {
    Fivetran: {
        filename: 'fivetran-mark.svg',
        brandColor: '#306BEA',
        sourceUrl: 'https://cdn.prod.website-files.com/6130fa1501794ed4d11867ba/63d9599008ad50523f8ce26a_logo.svg',
        licenseType: 'Fivetran brand artwork',
        licenseUrl: 'https://www.fivetran.com/',
    },
    'Adobe Analytics': {
        filename: 'adobe-analytics.svg',
        brandColor: '#FA0F00',
        sourceUrl: 'https://logos-download.com/brands/adobe-analytics',
        licenseType: 'Adobe brand artwork',
        licenseUrl: 'https://www.adobe.com/legal/permissions/trademarks.html',
    },
    gRPC: theSvgIcon('grpc-mark.svg', 'public/icons/grpc/default.svg', '#00B5B2'),
    GeoServer: {
        filename: 'geoserver-icon.png.base64',
        format: 'base64-png',
        brandColor: '#0092C8',
        sourceUrl: 'https://github.com/geoserver/geoserver/blob/main/doc/en/docguide/img/logo-icon.svg',
        licenseType: 'GPL-2.0',
        licenseUrl: 'https://github.com/geoserver/geoserver/blob/main/COPYING',
    },
    PostGIS: {
        filename: 'postgis-icon.png.base64',
        format: 'base64-png',
        brandColor: '#288C68',
        sourceUrl: 'https://postgis.net/favicon/favicon.svg',
        licenseType: 'GPL-2.0',
        licenseUrl: 'https://github.com/postgis/postgis/blob/master/COPYING',
    },
    'Amazon Bedrock': {
        filename: 'amazon-bedrock.svg',
        brandColor: '#01A88D',
        sourceUrl: 'https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/architecture/approved/architecture-icons/Icon-package_04302026.4705b90f5aa45b019271a2699e9ce9b97b941ee1.zip',
        licenseType: 'AWS Architecture Icons Terms',
        licenseUrl: 'https://aws.amazon.com/architecture/icons/',
    },
    'Amazon Bedrock Agents': {
        filename: 'amazon-bedrock.svg',
        brandColor: '#01A88D',
        sourceUrl: 'https://github.com/glincker/thesvg/blob/e25d9e9c43c40f353a5b1c109c9d288d8a4fa16b/public/icons/aws-amazon-bedrock/default.svg',
        licenseType: 'MIT',
        licenseUrl: THESVG_LICENSE_URL,
    },
    TestFlight: {
        filename: 'testflight-app-icon.jpg.base64',
        format: 'base64-jpeg',
        brandColor: '#0A84FF',
        sourceUrl: 'https://apps.apple.com/us/app/testflight/id899247664',
        licenseType: 'Apple App Store artwork',
        licenseUrl: 'https://developer.apple.com/testflight/',
    },
    Codex: theSvgIcon('codex-openai.svg', 'public/icons/codex-openai/color.svg', '#478BFF'),
    'Google Antigravity': theSvgIcon('antigravity-google.svg', 'public/icons/antigravity-google/color.svg', '#3186FF'),
    LangSmith: theSvgIcon('langsmith.svg', 'public/icons/langsmith-langchain/color.svg', '#111111'),
    Langfuse: theSvgIcon('langfuse.svg', 'public/icons/langfuse/color.svg', '#111111'),
    'Arize Phoenix': theSvgIcon('arize-phoenix.svg', 'public/icons/phoenix/default.svg', '#F36F21'),
    Promptfoo: theSvgIcon('promptfoo.svg', 'public/icons/promptfoo/default.svg', '#E33A2C'),
    Ragas: theSvgIcon('ragas.svg', 'public/icons/ragas/default.svg', '#7C3AED'),
    Cerebras: theSvgIcon('cerebras.svg', 'public/icons/cerebras/color.svg', '#F97316'),
    SambaNova: theSvgIcon('sambanova.svg', 'public/icons/sambanova/color.svg', '#111111'),
    Baseten: theSvgIcon('baseten.svg', 'public/icons/baseten/default.svg', '#111111'),
    Anyscale: theSvgIcon('anyscale.svg', 'public/icons/anyscale/color.svg', '#028CF0'),
    Runpod: theSvgIcon('runpod.svg', 'public/icons/runpod/default.svg', '#5B4FE9'),
    'Stability AI': theSvgIcon('stability-ai.svg', 'public/icons/stability-ai/default.svg', '#111111'),
    AssemblyAI: theSvgIcon('assemblyai.svg', 'public/icons/assemblyai/color.svg', '#6C5CE7'),
    Vapi: theSvgIcon('vapi.svg', 'public/icons/vapi/default.svg', '#111111'),
    OpenVINO: theSvgIcon('openvino.svg', 'public/icons/openvino/default.svg', '#00C7FD'),
    Continue: theSvgIcon('continue.svg', 'public/icons/continue/default.svg', '#111111'),
    Kiro: theSvgIcon('kiro.svg', 'public/icons/kiro/default.svg', '#7C3AED'),
    'Sourcegraph Cody': theSvgIcon('sourcegraph-cody.svg', 'public/icons/cody/default.svg', '#FF5543'),
    'Amazon Q Developer': theSvgIcon('amazon-q-developer.svg', 'public/icons/aws-amazon-q/default.svg', '#8C4FFF'),
    AutoGen: {
        filename: 'autogen.svg',
        brandColor: '#2D2D2F',
        sourceUrl: 'https://github.com/microsoft/autogen/blob/main/python/docs/src/_static/images/logo/logo.svg',
        licenseType: 'CC-BY-4.0',
        licenseUrl: 'https://github.com/microsoft/autogen/blob/main/LICENSE',
    },
    Chroma: {
        filename: 'chroma.svg',
        brandColor: '#327EFF',
        sourceUrl: 'https://github.com/gilbarbara/logos/blob/main/logos/chroma.svg',
        licenseType: 'CC0-1.0',
        licenseUrl: 'https://github.com/gilbarbara/logos/blob/main/LICENSE.txt',
    },
    Assembly: {
        filename: 'assembly-geticon.svg',
        brandColor: '#25344C',
        sourceUrl: 'https://github.com/get-icon/geticon/blob/fc0f660daee147afb4a56c64e12bde6486b73e39/icons/assembly.svg',
        licenseType: 'CC0-1.0',
        licenseUrl: 'https://github.com/get-icon/geticon/blob/fc0f660daee147afb4a56c64e12bde6486b73e39/LICENSE',
    },
    'Microsoft Excel': {
        filename: 'microsoft-excel-geticon.svg',
        brandColor: '#107C41',
        sourceUrl: 'https://github.com/get-icon/geticon/blob/fc0f660daee147afb4a56c64e12bde6486b73e39/icons/microsoft-office-excel.svg',
        licenseType: 'CC0-1.0',
        licenseUrl: 'https://github.com/get-icon/geticon/blob/fc0f660daee147afb4a56c64e12bde6486b73e39/LICENSE',
    },
    'Adobe Firefly': {
        filename: 'adobe-firefly-iconic.svg',
        brandColor: '#EB1000',
        sourceUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/icons/light/adobe-firefly.svg',
        licenseType: 'MIT',
        licenseUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/LICENSE',
    },
    'Adobe Audition': {
        filename: 'adobe-audition.svg',
        brandColor: '#9999FF',
        sourceUrl: 'https://github.com/get-icon/geticon/blob/fc0f660daee147afb4a56c64e12bde6486b73e39/icons/adobe-audition.svg',
        licenseType: 'CC0-1.0',
        licenseUrl: 'https://github.com/get-icon/geticon/blob/fc0f660daee147afb4a56c64e12bde6486b73e39/LICENSE',
    },
    Rspack: theSvgIcon('rspack.svg', 'public/icons/rspack/default.svg', '#FE5A1F'),
    Valkey: theSvgIcon('valkey.svg', 'public/icons/valkey/default.svg', '#FF4438'),
    Dagster: theSvgIcon('dagster.svg', 'public/icons/dagster/default.svg', '#654FF0'),
    LlamaIndex: theSvgIcon('llamaindex.svg', 'public/icons/llamaindex/color.svg', '#000000'),
    'Google Vertex AI': theSvgIcon('vertex-ai.svg', 'public/icons/vertexai-google/color.svg', '#4285F4'),
    Weaviate: {
        ...theSvgIcon('weaviate.svg', 'public/icons/weaviate/default.svg', '#00B977'),
        viewBox: '0 0 30 18',
    },
    XGBoost: theSvgIcon('xgboost.svg', 'public/icons/xgboost/default.svg', '#1892D0'),
    Cohere: theSvgIcon('cohere.svg', 'public/icons/cohere/color.svg', '#39594D'),
    Groq: theSvgIcon('groq.svg', 'public/icons/groq/default.svg', '#F55036'),
    GroqCloud: theSvgIcon('groq.svg', 'public/icons/groq/default.svg', '#F55036'),
    'Together AI': theSvgIcon('together-ai.svg', 'public/icons/together-ai/default.svg', '#000000'),
    'Comet ML': theSvgIcon('comet-ml.svg', 'public/icons/comet-api/color.svg', '#6F42C1'),
    Feast: theSvgIcon('feast.svg', 'public/icons/feast/default.svg', '#036AEA'),
    'Dev Containers': theSvgIcon('dev-containers.svg', 'public/icons/development-containers/default.svg', '#2496ED'),
    Bolt: theSvgIcon('bolt.svg', 'public/icons/bolt/default.svg', '#1389FD'),
    Lovable: theSvgIcon('lovable.svg', 'public/icons/lovable/default.svg', '#FF4D82'),
    'Roo Code': theSvgIcon('roo-code.svg', 'public/icons/roocode/default.svg', '#6B57FF'),
    Trae: theSvgIcon('trae.svg', 'public/icons/trae/color.svg', '#000000'),
    'Microsoft Planner': theSvgIcon('microsoft-planner.svg', 'public/icons/microsoft-planner/default.svg', '#31752F'),
    OpenXR: theSvgIcon('openxr.svg', 'public/icons/openxr/default.svg', '#000000'),
    Phaser: theSvgIcon('phaser.svg', 'public/icons/phaser/default.svg', '#8A57A8'),
    FreeRTOS: theSvgIcon('freertos.svg', 'public/icons/aws-freertos/default.svg', '#232F3E'),
    Zephyr: theSvgIcon('zephyr.svg', 'public/icons/zephyr/default.svg', '#6C4C9F'),
    Avalanche: theSvgIcon('avalanche.svg', 'public/icons/avalanche/default.svg', '#E84142'),
    'Microsoft Power Platform': theSvgIcon('power-platform.svg', 'public/icons/azure-power-platform/default.svg', '#742774'),
    Workday: theSvgIcon('workday.svg', 'public/icons/workday/default.svg', '#F68D2E'),
    Ahrefs: theSvgIcon('ahrefs.svg', 'public/icons/ahrefs/default.svg', '#FF8800'),
    'Apache Beam': {
        filename: 'apache-beam.svg',
        brandColor: '#F26622',
        sourceUrl: 'https://github.com/apache/beam/blob/b9a506743a126452234ad7018d232c56790aa533/website/www/site/static/images/beam_logo_circle.svg',
        licenseType: 'Apache-2.0',
        licenseUrl: 'https://github.com/apache/beam/blob/b9a506743a126452234ad7018d232c56790aa533/LICENSE',
    },
    'Great Expectations': {
        filename: 'great-expectations.svg',
        brandColor: '#FF6310',
        sourceUrl: 'https://github.com/great-expectations/great_expectations/blob/9708bca0d6604adbc175429f9504a275aaa8e856/docs/docusaurus/static/img/gx-mark.svg',
        licenseType: 'Apache-2.0',
        licenseUrl: 'https://github.com/great-expectations/great_expectations/blob/9708bca0d6604adbc175429f9504a275aaa8e856/LICENSE',
    },
    'Apache Iceberg': {
        filename: 'apache-iceberg.svg',
        brandColor: '#4B8BBE',
        sourceUrl: 'https://github.com/apache/iceberg/blob/49b89a8c59d7d88290c6e925f41b65fa9fc99a88/site/docs/assets/images/Iceberg-logo.svg',
        licenseType: 'Apache-2.0',
        licenseUrl: 'https://github.com/apache/iceberg/blob/49b89a8c59d7d88290c6e925f41b65fa9fc99a88/LICENSE',
    },
    Meltano: {
        filename: 'meltano.svg',
        brandColor: '#103865',
        sourceUrl: 'https://github.com/meltano/meltano/blob/ef1b037c862c36cdefad9cb1afa72148e9edde99/docs/docs/reference/images/icon.svg',
        licenseType: 'MIT',
        licenseUrl: 'https://github.com/meltano/meltano/blob/ef1b037c862c36cdefad9cb1afa72148e9edde99/LICENSE',
    },
    CapCut: {
        filename: 'capcut-iconic.svg',
        brandColor: '#F2F2F2',
        sourceUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/icons/light/capcut.svg',
        licenseType: 'MIT',
        licenseUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/LICENSE',
    },
    'Affinity Designer': {
        filename: 'affinity-iconic.svg',
        brandColor: '#134881',
        sourceUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/icons/light/affinity.svg',
        licenseType: 'MIT',
        licenseUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/LICENSE',
    },
    'Affinity Photo': {
        filename: 'affinity-iconic.svg',
        brandColor: '#134881',
        sourceUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/icons/light/affinity.svg',
        licenseType: 'MIT',
        licenseUrl: 'https://github.com/YuheshPandian/ICONIC/blob/dcb8107fd7f903b9f9922e09695c22452a8d360c/LICENSE',
    },
}

function sqlString(value: string | null | undefined): string {
    if (value == null) return 'NULL'
    return `'${value.replaceAll("'", "''")}'`
}

function jsonSql(value: unknown): string {
    return `${sqlString(JSON.stringify(value))}::jsonb`
}

function simpleIconEntries(): SimpleIcon[] {
    return (Object.values(simpleIcons) as unknown[]).filter((value) => {
        if (!value || typeof value !== 'object') return false
        const candidate = value as Partial<SimpleIcon>
        return typeof candidate.title === 'string' && typeof candidate.slug === 'string' && typeof candidate.path === 'string'
    }).map((value) => value as SimpleIcon)
}

async function main() {
const icons = simpleIconEntries()
const bySlug = new Map(icons.map((icon) => [icon.slug, icon]))
const byName = new Map<string, SimpleIcon>()
for (const icon of icons) {
    const key = normalizeSkillLookup(icon.title)
    if (!byName.has(key)) byName.set(key, icon)
}

const deviconEntries = JSON.parse(await readFile(path.join(deviconRoot, 'devicon.json'), 'utf8')) as DeviconIcon[]
const deviconByName = new Map<string, DeviconIcon>()
for (const icon of deviconEntries) {
    for (const value of [icon.name, ...(icon.altnames ?? [])]) {
        const key = normalizeSkillLookup(value)
        if (key && !deviconByName.has(key)) deviconByName.set(key, icon)
    }
}
const logosByName = buildIconifyIndex(logosCollection)
const skillIconsByName = buildIconifyIndex(skillIconsCollection)
const developerIconByName = buildDeveloperIconIndex()

await rm(assetDir, { recursive: true, force: true })
await mkdir(assetDir, { recursive: true })

const manifest: Record<string, GeneratedBrandIcon> = {}
const writtenAssets = new Set<string>()
const themeAssetVariants: Record<string, { lightIconKey: string; darkIconKey: string; rationale: 'upstream-theme-pair' }> = {}

async function writeIconifyIcon(
    skillName: string,
    source: 'skill-icons' | 'logos',
    key: string,
    options: { removeFirstShape?: boolean } = {},
): Promise<GeneratedBrandIcon> {
    const generated = iconifyBrandIcon(skillName, source, key)
    if (!generated) throw new Error(`Missing ${source} icon ${key} for ${skillName}`)
    const light = await writeGeneratedIcon(generated, writtenAssets, { ...options, skipRecolor: true })
    if (source === 'skill-icons' && key.endsWith('-light')) {
        const darkKey = `${key.slice(0, -'-light'.length)}-dark`
        const darkGenerated = iconifyBrandIcon(skillName, source, darkKey)
        if (darkGenerated) {
            const dark = await writeGeneratedIcon(darkGenerated, writtenAssets, { ...options, skipRecolor: true })
            themeAssetVariants[light.assetKey] = {
                lightIconKey: light.assetKey,
                darkIconKey: dark.assetKey,
                rationale: 'upstream-theme-pair',
            }
        }
    }
    return light
}

for (const skill of MARKET_SKILLS) {
    const skillLookupKeys = [skill.name, ...skill.aliases].map(normalizeSkillLookup).filter(Boolean)
    if (SKILL_SEMANTIC_ICON_ONLY.has(skill.name)) continue
    const explicitDeveloperIcon = SKILL_DEVELOPER_ICON_OVERRIDES[skill.name]
    if (explicitDeveloperIcon) {
        const svg = developerIconSvg(explicitDeveloperIcon)
        if (!svg) throw new Error(`Missing developer-icons override ${explicitDeveloperIcon} for ${skill.name}`)
        const sourceRecord = SKILL_ICON_SOURCE_REGISTRY.find((entry) => entry.id === 'developer-icons')!
        manifest[skill.canonicalKey] = await writeGeneratedIcon({
            source: 'developer-icons',
            assetKey: `developer-icons-${skillSlug(explicitDeveloperIcon)}`,
            sourceSlug: explicitDeveloperIcon,
            sourceVersion: sourceRecord.packageVersion!,
            brandColor: null,
            sourceUrl: `${sourceRecord.repository}/tree/v${sourceRecord.packageVersion}`,
            guidelinesUrl: sourceRecord.repository,
            licenseType: sourceRecord.license,
            licenseUrl: `${sourceRecord.repository}/blob/${sourceRecord.auditedCommit}/LICENSE`,
            svg,
        }, writtenAssets)
        continue
    }

    const explicitIconify = SKILL_ICONIFY_OVERRIDES[skill.name]
    if (explicitIconify) {
        manifest[skill.canonicalKey] = await writeIconifyIcon(skill.name, explicitIconify.source, explicitIconify.key, {
            removeFirstShape: REMOVE_FIRST_CANVAS_SHAPE.has(skill.name),
        })
        continue
    }

    const override = SKILL_ICON_OVERRIDES[skill.name]
    const icon = (override ? bySlug.get(override) : null)
        ?? skillLookupKeys.map((key) => byName.get(key)).find(Boolean)
    if (icon) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 24 24"><title>${icon.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</title><path d="${icon.path}"/></svg>\n`
        const checksum = createHash('sha256').update(svg).digest('hex')
        const filename = `${icon.slug}.svg`
        if (!writtenAssets.has(filename)) {
            await writeFile(path.join(assetDir, filename), svg, 'utf8')
            writtenAssets.add(filename)
        }
        manifest[skill.canonicalKey] = {
            source: 'simple-icons',
            assetKey: icon.slug,
            sourceSlug: icon.slug,
            sourceVersion: SKILL_ICON_SOURCE_VERSION,
            assetPath: `/skill-icons/v1/${filename}`,
            brandColor: `#${icon.hex}`,
            checksum,
            sourceUrl: icon.source,
            guidelinesUrl: icon.guidelines ?? null,
            licenseType: icon.license?.type ?? null,
            licenseUrl: icon.license?.url ?? null,
        }
        continue
    }

    const curated = CURATED_ICONS[skill.name]
    if (curated) {
        const sourcePath = path.join(curatedIconRoot, curated.filename)
        const isJpeg = curated.format === 'base64-jpeg'
        const isPng = curated.format === 'base64-png'
        const isBinary = isJpeg || isPng
        const loadedContent = isBinary
            ? Buffer.from((await readFile(sourcePath, 'utf8')).replace(/\s+/g, ''), 'base64')
            : `${(await readFile(sourcePath, 'utf8')).trim()}\n`
        const rawContent = !isBinary && curated.viewBox
            ? (loadedContent as string).replace(/\sviewBox=(?:"[^"]*"|'[^']*')/i, ` viewBox="${curated.viewBox}"`)
            : loadedContent
        const content = isBinary
            ? rawContent
            : normalizeTransparentSvg(cleanSvg(rawContent as string), {
                removeFirstShape: REMOVE_FIRST_CANVAS_SHAPE.has(skill.name),
            }).svg
        if (isJpeg) {
            const bytes = content as Buffer
            if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
                throw new Error(`Invalid curated JPEG for ${skill.name}: ${curated.filename}`)
            }
        } else if (isPng) {
            const bytes = content as Buffer
            const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
            if (bytes.length < signature.length || !signature.every((value, index) => bytes[index] === value)) {
                throw new Error(`Invalid curated PNG for ${skill.name}: ${curated.filename}`)
            }
        } else if (!isSingleSvgDocument(content as string) || isUnsafeSvg(content as string)) {
            throw new Error(`Invalid or unsafe curated SVG for ${skill.name}: ${curated.filename}`)
        }
        const baseAssetKey = `curated-${skillSlug(skill.name)}`
        const assetKey = isJpeg ? `${baseAssetKey}.jpg` : isPng ? `${baseAssetKey}.png` : baseAssetKey
        const filename = isBinary ? assetKey : `${assetKey}.svg`
        const checksum = createHash('sha256').update(content).digest('hex')
        await writeFile(path.join(assetDir, filename), content, isBinary ? undefined : 'utf8')
        writtenAssets.add(filename)
        manifest[skill.canonicalKey] = {
            source: 'custom',
            assetKey,
            sourceSlug: skillSlug(skill.name),
            sourceVersion: SKILL_CATALOG_VERSION,
            assetPath: `/skill-icons/v1/${filename}`,
            brandColor: curated.brandColor,
            checksum,
            sourceUrl: curated.sourceUrl,
            guidelinesUrl: null,
            licenseType: curated.licenseType,
            licenseUrl: curated.licenseUrl,
        }
        continue
    }

    const deviconOverride = SKILL_DEVICON_OVERRIDES[skill.name]
    const devicon = (deviconOverride ? deviconByName.get(normalizeSkillLookup(deviconOverride)) : null)
        ?? skillLookupKeys.map((key) => deviconByName.get(key)).find(Boolean)
    const variants = devicon?.versions.svg ?? []

    let sourceFilename: string | null = null
    let svg: string | null = null
    for (const variant of devicon ? ['original', 'plain', 'line', 'original-wordmark', 'plain-wordmark', 'line-wordmark'] : []) {
        if (!variants.includes(variant)) continue
        const candidateFilename = `${devicon!.name}-${variant}.svg`
        const candidatePath = path.join(deviconRoot, 'icons', devicon!.name, candidateFilename)
        const candidateSvg = `${(await readFile(candidatePath, 'utf8'))
            .replace(/<\?xml[^>]*>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim()}\n`
        const unsafe = isUnsafeSvg(candidateSvg)
        const hasShape = /<(path|polygon|polyline|circle|rect|ellipse)\b/i.test(candidateSvg)
        if (!unsafe && hasShape && isSingleSvgDocument(candidateSvg)) {
            sourceFilename = candidateFilename
            svg = candidateSvg
            break
        }
    }
    if (sourceFilename && svg) {
        manifest[skill.canonicalKey] = await writeGeneratedIcon({
            source: 'devicon',
            assetKey: `devicon-${devicon!.name}`,
            sourceSlug: devicon!.name,
            sourceVersion: SKILL_DEVICON_SOURCE_VERSION,
            brandColor: devicon!.color,
            sourceUrl: `https://github.com/devicons/devicon/blob/v${SKILL_DEVICON_SOURCE_VERSION}/icons/${devicon!.name}/${sourceFilename}`,
            guidelinesUrl: 'https://github.com/devicons/devicon#about-the-project',
            licenseType: 'MIT',
            licenseUrl: 'https://github.com/devicons/devicon/blob/master/LICENSE',
            svg,
        }, writtenAssets)
        continue
    }

    const automaticDeveloperIcon = skillLookupKeys.map((key) => developerIconByName.get(key)).find(Boolean)
    if (automaticDeveloperIcon) {
        const generatedSvg = developerIconSvg(automaticDeveloperIcon)
        if (generatedSvg) {
            const sourceRecord = SKILL_ICON_SOURCE_REGISTRY.find((entry) => entry.id === 'developer-icons')!
            manifest[skill.canonicalKey] = await writeGeneratedIcon({
                source: 'developer-icons',
                assetKey: `developer-icons-${skillSlug(automaticDeveloperIcon)}`,
                sourceSlug: automaticDeveloperIcon,
                sourceVersion: sourceRecord.packageVersion!,
                brandColor: null,
                sourceUrl: `${sourceRecord.repository}/tree/v${sourceRecord.packageVersion}`,
                guidelinesUrl: sourceRecord.repository,
                licenseType: sourceRecord.license,
                licenseUrl: `${sourceRecord.repository}/blob/${sourceRecord.auditedCommit}/LICENSE`,
                svg: generatedSvg,
            }, writtenAssets)
            continue
        }
    }

    const automaticLogo = skillLookupKeys.map((key) => logosByName.get(key)).find(Boolean)
    if (automaticLogo) {
        const generated = iconifyBrandIcon(skill.name, 'logos', automaticLogo)
        if (generated) {
            manifest[skill.canonicalKey] = await writeGeneratedIcon(generated, writtenAssets)
            continue
        }
    }

    const automaticSkillIcon = skillLookupKeys.map((key) => skillIconsByName.get(key)).find(Boolean)
    if (automaticSkillIcon) {
        manifest[skill.canonicalKey] = await writeIconifyIcon(skill.name, 'skill-icons', automaticSkillIcon)
    }
}

const manifestHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
const manifestSource = `// Generated by scripts/generate-skill-catalog.ts. Do not edit manually.\n` +
    `export const SKILL_ICON_MANIFEST_VERSION = '${SKILL_CATALOG_VERSION}' as const\n` +
    `export const SKILL_ICON_MANIFEST_HASH = '${manifestHash}' as const\n` +
    `export const SKILL_ICON_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const\n` +
    `export type SkillIconManifestKey = keyof typeof SKILL_ICON_MANIFEST\n`
await writeFile(manifestPath, manifestSource, 'utf8')

const themeAssetVariantsSource = `// Generated by scripts/generate-skill-catalog.ts. Do not edit manually.\n` +
    `export const GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS = ${JSON.stringify(themeAssetVariants, null, 2)} as const\n`
await writeFile(themeAssetVariantsPath, themeAssetVariantsSource, 'utf8')

const clientLookup: Record<string, readonly [string, string, string, string, string | null, string, string]> = {}
for (const skill of MARKET_SKILLS) {
    const icon = manifest[skill.canonicalKey]
    const summary = [
        skill.canonicalKey,
        skill.name,
        icon?.source ?? skill.iconSource,
        icon?.assetKey ?? skill.iconKey,
        icon?.brandColor ?? skill.brandColor,
        skill.categoryKey,
        skill.kind,
    ] as const
    for (const key of [skill.name, skill.slug, skill.canonicalKey, ...skill.aliases]) {
        const normalized = normalizeSkillLookup(key)
        if (normalized && !clientLookup[normalized]) clientLookup[normalized] = summary
    }
}
const clientCatalogSource = `// Generated by scripts/generate-skill-catalog.ts. Do not edit manually.\n` +
    `export const SKILL_CLIENT_CATALOG_VERSION = '${SKILL_CATALOG_VERSION}' as const\n` +
    `export const SKILL_CLIENT_CATEGORIES = ${JSON.stringify(SKILL_CATEGORIES.map(({ key, name, iconKey }) => ({ key, name, iconKey })), null, 2)} as const\n` +
    `export const SKILL_CLIENT_LOOKUP = ${JSON.stringify(clientLookup, null, 2)} as const\n` +
    `export const DEFAULT_SKILL_CLIENT_KEYS = ${JSON.stringify(DEFAULT_ONBOARDING_SKILLS.map((skill) => normalizeSkillLookup(skill.name)), null, 2)} as const\n`
await writeFile(clientCatalogPath, clientCatalogSource, 'utf8')

const sql: string[] = [
    '-- Generated by scripts/generate-skill-catalog.ts. Do not edit manually.',
    `-- Catalog release ${SKILL_CATALOG_VERSION}; icon sources simple-icons ${SKILL_ICON_SOURCE_VERSION}, devicon ${SKILL_DEVICON_SOURCE_VERSION}, skill-icons ${PACKAGE_SOURCE_VERSIONS['skill-icons']}, logos ${PACKAGE_SOURCE_VERSIONS.logos}, and developer-icons ${PACKAGE_SOURCE_VERSIONS['developer-icons']}.`,
    '',
    'ALTER TABLE "skills" DROP CONSTRAINT IF EXISTS "skills_icon_source_check";',
    'ALTER TABLE "skills" ADD CONSTRAINT "skills_icon_source_check" CHECK ("icon_source" IN (\'simple-icons\',\'devicon\',\'skill-icons\',\'logos\',\'developer-icons\',\'lucide\',\'custom\',\'monogram\'));',
    'ALTER TABLE "skill_icon_assets" DROP CONSTRAINT IF EXISTS "skill_icon_assets_source_check";',
    'ALTER TABLE "skill_icon_assets" ADD CONSTRAINT "skill_icon_assets_source_check" CHECK ("source" IN (\'simple-icons\',\'devicon\',\'skill-icons\',\'logos\',\'developer-icons\',\'lucide\',\'custom\'));',
    '',
]

for (const category of SKILL_CATEGORIES) {
    sql.push(`INSERT INTO "skill_categories" ("key", "name", "description", "icon_key", "display_order", "status", "updated_at") VALUES (${sqlString(category.key)}, ${sqlString(category.name)}, ${sqlString(category.description)}, ${sqlString(category.iconKey)}, ${category.displayOrder}, 'active', now()) ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "icon_key" = EXCLUDED."icon_key", "display_order" = EXCLUDED."display_order", "status" = 'active', "updated_at" = now();`)
}

sql.push('')
for (const skill of MARKET_SKILLS) {
    const icon = manifest[skill.canonicalKey]
    const iconSource = icon?.source ?? 'lucide'
    const iconKey = icon?.assetKey ?? skill.iconKey
    const brandColor = icon?.brandColor ?? null
    sql.push(`UPDATE "skills" AS existing SET "canonical_key" = ${sqlString(skill.canonicalKey)}, "category_id" = (SELECT "id" FROM "skill_categories" WHERE "key" = ${sqlString(skill.categoryKey)}), "kind" = ${sqlString(skill.kind)}, "icon_source" = ${sqlString(iconSource)}, "icon_key" = ${sqlString(iconKey)}, "brand_color" = ${sqlString(brandColor)}, "market_tier" = ${sqlString(skill.marketTier)}, "catalog_version" = ${sqlString(SKILL_CATALOG_VERSION)}, "last_reviewed_at" = now(), "updated_at" = now() WHERE (lower(existing."name") = lower(${sqlString(skill.name)}) OR existing."slug" = ${sqlString(skill.slug)}) AND NOT EXISTS (SELECT 1 FROM "skills" AS canonical WHERE canonical."canonical_key" = ${sqlString(skill.canonicalKey)} AND canonical."id" <> existing."id");`)
    sql.push(`INSERT INTO "skills" ("canonical_key", "name", "slug", "category_id", "kind", "description", "icon_source", "icon_key", "brand_color", "market_tier", "status", "selectable", "source_metadata", "catalog_version", "last_reviewed_at", "updated_at") VALUES (${sqlString(skill.canonicalKey)}, ${sqlString(skill.name)}, ${sqlString(skill.slug)}, (SELECT "id" FROM "skill_categories" WHERE "key" = ${sqlString(skill.categoryKey)}), ${sqlString(skill.kind)}, ${sqlString(skill.description)}, ${sqlString(iconSource)}, ${sqlString(iconKey)}, ${sqlString(brandColor)}, ${sqlString(skill.marketTier)}, 'active', true, ${jsonSql({ source: 'nb-market-catalog' })}, ${sqlString(SKILL_CATALOG_VERSION)}, now(), now()) ON CONFLICT ("canonical_key") DO UPDATE SET "name" = EXCLUDED."name", "slug" = EXCLUDED."slug", "category_id" = EXCLUDED."category_id", "kind" = EXCLUDED."kind", "description" = EXCLUDED."description", "icon_source" = EXCLUDED."icon_source", "icon_key" = EXCLUDED."icon_key", "brand_color" = EXCLUDED."brand_color", "market_tier" = EXCLUDED."market_tier", "status" = 'active', "selectable" = true, "source_metadata" = EXCLUDED."source_metadata", "catalog_version" = ${sqlString(SKILL_CATALOG_VERSION)}, "last_reviewed_at" = now(), "updated_at" = now();`)
}

sql.push('')
for (const skill of MARKET_SKILLS) {
    for (const alias of [skill.name, ...skill.aliases]) {
        sql.push(`INSERT INTO "skill_aliases" ("skill_id", "alias", "normalized_alias", "locale", "source", "is_preferred") SELECT "id", ${sqlString(alias)}, ${sqlString(normalizeSkillLookup(alias))}, 'en', 'catalog', ${alias === skill.name ? 'true' : 'false'} FROM "skills" WHERE "canonical_key" = ${sqlString(skill.canonicalKey)} ON CONFLICT ("normalized_alias", "locale") DO UPDATE SET "skill_id" = EXCLUDED."skill_id", "alias" = EXCLUDED."alias", "source" = 'catalog', "is_preferred" = EXCLUDED."is_preferred";`)
    }
}

sql.push('')
for (const [canonicalKey, icon] of Object.entries(manifest)) {
    sql.push(`INSERT INTO "skill_icon_assets" ("icon_key", "source", "source_slug", "source_version", "asset_path", "checksum", "brand_color", "license_type", "license_url", "source_url", "guidelines_url", "approval_status", "last_reviewed_at", "updated_at") VALUES (${sqlString(icon.assetKey)}, ${sqlString(icon.source)}, ${sqlString(icon.sourceSlug)}, ${sqlString(icon.sourceVersion)}, ${sqlString(icon.assetPath)}, ${sqlString(icon.checksum)}, ${sqlString(icon.brandColor)}, ${sqlString(icon.licenseType)}, ${sqlString(icon.licenseUrl)}, ${sqlString(icon.sourceUrl)}, ${sqlString(icon.guidelinesUrl)}, 'catalog_approved', now(), now()) ON CONFLICT ("icon_key") DO UPDATE SET "source" = EXCLUDED."source", "source_slug" = EXCLUDED."source_slug", "source_version" = EXCLUDED."source_version", "asset_path" = EXCLUDED."asset_path", "checksum" = EXCLUDED."checksum", "brand_color" = EXCLUDED."brand_color", "license_type" = EXCLUDED."license_type", "license_url" = EXCLUDED."license_url", "source_url" = EXCLUDED."source_url", "guidelines_url" = EXCLUDED."guidelines_url", "approval_status" = 'catalog_approved', "last_reviewed_at" = now(), "updated_at" = now();`)
    void canonicalKey
}

const simpleIconCount = Object.values(manifest).filter((icon) => icon.source === 'simple-icons').length
const deviconCount = Object.values(manifest).filter((icon) => icon.source === 'devicon').length
const skillIconCount = Object.values(manifest).filter((icon) => icon.source === 'skill-icons').length
const logosCount = Object.values(manifest).filter((icon) => icon.source === 'logos').length
const developerIconCount = Object.values(manifest).filter((icon) => icon.source === 'developer-icons').length
const curatedIconCount = Object.values(manifest).filter((icon) => icon.source === 'custom').length
await writeFile(seedMigrationPath, `${sql.join('\n')}\n`, 'utf8')

// Generate SVG Sprite Sheet including all local brand icons and Lucide icons
console.log("Generating SVG Sprite Sheet at public/skill-sprites.svg...")
const spriteSymbols: string[] = []

// 1. Process all generated brand assets (SVGs)
for (const filename of Array.from(writtenAssets).sort()) {
    if (!filename.endsWith('.svg')) continue
    const filePath = path.join(assetDir, filename)
    const svgContent = await readFile(filePath, 'utf8')
    
    // Extract viewBox
    const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i)
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24'
    
    // Extract inner content (strip <svg ...> and </svg> and clean XML namespace junk)
    let innerContent = svgContent
        .replace(/<svg[^>]*>/i, '')
        .replace(/<\/svg>/i, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<\?xml[^>]*\?>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<metadata[^>]*>[\s\S]*?<\/metadata>/gi, '')
        .replace(/<(?:sodipodi|inkscape|rdf|dc|cc):[^>]*>[\s\S]*?<\/(?:sodipodi|inkscape|rdf|dc|cc):[^>]*>/gi, '')
        .replace(/<(?:sodipodi|inkscape|rdf|dc|cc):[^>]*\/>/gi, '')
        // Clean up all attributes containing non-standard namespace prefixes (except xlink:, xml:, xmlns:)
        .replace(/\b(?!(?:xlink|xml|xmlns)\b)[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+=(["'])[\s\S]*?\1/gi, '')
        .trim()
        
    // Generate clean symbol ID matching the assetKey (without suffix)
    const assetKey = filename.slice(0, -4)
    const symbolId = `skill-${assetKey}`
    
    // Detect if this asset is a monochrome simple-icon or defined in the theme policy map
    const manifestIcon = Object.values(manifest).find(icon => icon.assetKey === assetKey)
    const isSimpleIcon = manifestIcon?.source === 'simple-icons'
    const isThemeVariant = SKILL_ICON_THEME_VARIANTS[assetKey] !== undefined
    
    if (isSimpleIcon || isThemeVariant) {
        innerContent = innerContent
            .replace(/fill=(["'])(?!none\b)#[a-fA-F0-9]{3,8}\1/gi, 'fill="currentColor"')
            .replace(/stroke=(["'])(?!none\b)#[a-fA-F0-9]{3,8}\1/gi, 'stroke="currentColor"')
    }
    
    spriteSymbols.push(`  <symbol id="${symbolId}" viewBox="${viewBox}">\n    ${innerContent.replace(/\n/g, '\n    ')}\n  </symbol>`)
}

// 2. Render all Lucide Icons to SVG symbols
console.log("Compiling Lucide symbols into sprite...")
for (const [key, Component] of Object.entries(LucideIcons)) {
    if (typeof Component === 'function' || (typeof Component === 'object' && Component !== null)) {
        try {
            const svgContent = renderToStaticMarkup(createElement(Component as any, { size: 24 }))
            const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i)
            const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24'
            const innerContent = svgContent
                .replace(/<svg[^>]*>/i, '')
                .replace(/<\/svg>/i, '')
                .trim()
                
            const kebabKey = key
                .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                .toLowerCase()
                
            spriteSymbols.push(`  <symbol id="skill-lucide-${kebabKey}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n    ${innerContent.replace(/\n/g, '\n    ')}\n  </symbol>`)
        } catch {
            // Skip non-component exports if any
        }
    }
}
const spriteSheet = 
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="display: none;">\n` +
    `${spriteSymbols.join('\n')}\n` +
    `</svg>\n`
await writeFile(path.join(root, 'public', 'skill-sprites.svg'), spriteSheet, 'utf8')
console.log(JSON.stringify({
    catalogVersion: SKILL_CATALOG_VERSION,
    skills: MARKET_SKILLS.length,
    categories: SKILL_CATEGORIES.length,
    brandedIcons: Object.keys(manifest).length,
    simpleIcons: simpleIconCount,
    devicon: deviconCount,
    skillIcons: skillIconCount,
    logos: logosCount,
    developerIcons: developerIconCount,
    curated: curatedIconCount,
    localAssets: writtenAssets.size,
    manifestHash,
}, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
