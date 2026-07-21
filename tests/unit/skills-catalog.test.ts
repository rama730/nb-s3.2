import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
    findCatalogSkill,
    MARKET_SKILLS,
    searchMarketSkills,
    SKILL_CATEGORIES,
} from '../../src/lib/skills/catalog'
import { resolveClientSkill } from '../../src/lib/skills/client'
import { canonicalizeSkillLabels, canonicalSkillKey, skillMatchScore } from '../../src/lib/skills/matching'
import { normalizeSkillInputList, normalizeSkillLookup, skillSlug } from '../../src/lib/skills/normalization'
import { getGeneratedSkillIcon } from '../../src/lib/skills/presentation'
import {
    detectPackageTechnologies,
    detectRepositoryFileTechnologies,
} from '../../src/lib/skills/repository-detection'

describe('market skill catalog', () => {
    it('covers broad market categories with stable unique identities', () => {
        assert.ok(MARKET_SKILLS.length >= 1100)
        assert.ok(SKILL_CATEGORIES.length >= 24)
        assert.equal(new Set(MARKET_SKILLS.map((skill) => skill.canonicalKey)).size, MARKET_SKILLS.length)
        assert.equal(new Set(MARKET_SKILLS.map((skill) => skill.slug)).size, MARKET_SKILLS.length)
    })

    it('keeps punctuation-sensitive programming languages distinct', () => {
        const values = ['C', 'C++', 'C#', 'F#', '.NET MAUI']
        assert.equal(new Set(values.map(normalizeSkillLookup)).size, values.length)
        assert.equal(new Set(values.map(skillSlug)).size, values.length)
        assert.notEqual(canonicalSkillKey('C'), canonicalSkillKey('C++'))
        assert.notEqual(canonicalSkillKey('C#'), canonicalSkillKey('F#'))
    })

    it('resolves common aliases to the preferred market identity', () => {
        assert.equal(findCatalogSkill('ReactJS')?.name, 'React')
        assert.equal(findCatalogSkill('AWS')?.name, 'Amazon Web Services')
        assert.equal(findCatalogSkill('K8s')?.name, 'Kubernetes')
        assert.equal(findCatalogSkill('UI/UX')?.name, 'UX Design')
        assert.equal(canonicalSkillKey('Postgres'), canonicalSkillKey('PostgreSQL'))
    })

    it('ranks exact aliases above partial results and respects filters', () => {
        const aliasResults = searchMarketSkills({ query: 'AWS', limit: 5 })
        assert.equal(aliasResults[0]?.name, 'Amazon Web Services')
        assert.equal(aliasResults[0]?.matchedAlias, 'AWS')

        const filtered = searchMarketSkills({ query: 'design', category: 'design', limit: 100 })
        assert.ok(filtered.length > 0)
        assert.ok(filtered.every((skill) => skill.categoryKey === 'design'))
    })

    it('matches aliases exactly and keeps ecosystem similarity weighted', () => {
        assert.equal(skillMatchScore('ReactJS', 'React'), 1)
        assert.equal(skillMatchScore('React', 'Next.js'), 0.9)
        assert.equal(skillMatchScore('React', 'Accounting'), 0)
    })

    it('deduplicates normalized writes and enforces the assignment cap', () => {
        const input = [' React ', 'React', 'ReactJS', ' C++ ', '', ...Array.from({ length: 30 }, (_, index) => `Skill ${index}`)]
        const normalized = normalizeSkillInputList(input, 5)
        assert.deepEqual(normalized.slice(0, 4), ['React', 'ReactJS', 'C++', 'Skill 0'])
        assert.equal(normalized.length, 5)
        assert.deepEqual(canonicalizeSkillLabels(['React', 'ReactJS', 'AWS', 'Amazon Web Services']), ['React', 'Amazon Web Services'])
    })

    it('uses local generated icons and deterministic monogram fallback', () => {
        const react = findCatalogSkill('React')!
        const icon = getGeneratedSkillIcon(react.canonicalKey)
        assert.ok(icon)
        assert.match(icon!.assetPath, /^\/skill-icons\/v1\/[a-z0-9-]+\.svg$/)
        assert.equal(resolveClientSkill('React.js').canonicalKey, react.canonicalKey)
        assert.equal(resolveClientSkill('Unlisted specialist skill').iconSource, 'monogram')
    })

    it('maps industry tools and specialized aliases to canonical icon-backed entries', () => {
        for (const name of ['Figma', 'Docker', 'GitHub', 'GitHub Actions', 'Chrome Extension API', 'MiniLM']) {
            const skill = resolveClientSkill(name)
            assert.equal(skill.iconSource, 'simple-icons', name)
            assert.ok(skill.iconKey, name)
        }
        assert.equal(findCatalogSkill('VS Code')?.name, 'Visual Studio Code')
        assert.equal(findCatalogSkill('Vector Database')?.name, 'Vector Databases')
        assert.equal(findCatalogSkill('similar embedding model')?.name, 'Embeddings')
    })

    it('uses audited brand assets and purposeful fallbacks for reported icon gaps', () => {
        const expected = [
            ['HTML', 'simple-icons', 'html5'],
            ['Java', 'devicon', 'devicon-java'],
            ['PowerShell', 'devicon', 'devicon-powershell'],
            ['Bash', 'simple-icons', 'gnubash'],
            ['SwiftUI', 'simple-icons', 'swift'],
            ['Amazon Bedrock', 'custom', 'curated-amazon-bedrock'],
            ['AutoGen', 'custom', 'curated-autogen'],
            ['Azure AI', 'devicon', 'devicon-azure'],
            ['Chroma', 'custom', 'curated-chroma'],
            ['Amazon Web Services', 'skill-icons', 'skill-icons-aws-light'],
            ['Microsoft Azure', 'devicon', 'devicon-azure'],
            ['Google Cloud Platform', 'simple-icons', 'googlecloud'],
            ['Assembly', 'custom', 'curated-assembly'],
            ['AI Agents', 'lucide', 'bot'],
            ['TestFlight', 'custom', 'curated-testflight.jpg'],
        ] as const

        for (const [name, source, iconKey] of expected) {
            const skill = resolveClientSkill(name)
            assert.equal(skill.iconSource, source, name)
            assert.equal(skill.iconKey, iconKey, name)
        }
    })

    it('covers newly audited market categories and licensed logo gaps', () => {
        for (const category of ['geospatial', 'operating-systems']) {
            assert.ok(SKILL_CATEGORIES.some((entry) => entry.key === category), category)
        }

        const expected = [
            ['Web Components', 'logos'],
            ['Apollo Client', 'skill-icons'],
            ['Axure RP', 'developer-icons'],
            ['Amazon Aurora', 'logos'],
            ['Microsoft Excel', 'custom'],
            ['Adobe Firefly', 'custom'],
            ['CapCut', 'custom'],
            ['Affinity Designer', 'custom'],
            ['3ds Max', 'devicon'],
            ['Red Hat Enterprise Linux', 'skill-icons'],
        ] as const
        for (const [name, source] of expected) {
            const skill = resolveClientSkill(name)
            assert.equal(skill.iconSource, source, name)
            assert.ok(getGeneratedSkillIcon(skill.canonicalKey), name)
        }
    })

    it('uses compact branded identities for the reported picker gaps', () => {
        const expected = [
            ['Adobe Illustrator', 'logos'],
            ['Adobe Photoshop', 'logos'],
            ['Adobe Premiere Pro', 'logos'],
            ['Adobe XD', 'logos'],
            ['Adobe Audition', 'custom'],
            ['Adobe Express', 'logos'],
            ['Adobe Commerce', 'logos'],
            ['WebSockets', 'lucide'],
            ['Amazon RDS', 'logos'],
            ['AWS Lambda', 'logos'],
            ['Apache Beam', 'custom'],
            ['Great Expectations', 'custom'],
            ['IBM Db2', 'logos'],
            ['Google Vertex AI', 'custom'],
            ['Groq', 'custom'],
            ['Adobe After Effects', 'logos'],
            ['Codex', 'custom'],
            ['Google Antigravity', 'custom'],
            ['Amazon Q Developer', 'custom'],
        ] as const

        for (const [name, source] of expected) {
            const skill = resolveClientSkill(name)
            assert.equal(skill.iconSource, source, name)
            if (source === 'lucide') assert.equal(skill.iconKey, 'network', name)
            else assert.ok(getGeneratedSkillIcon(skill.canonicalKey), name)
        }
    })

    it('expands mobile, AI, agentic tooling, and operating systems without changing stable identities', () => {
        for (const [name, category] of [
            ['App Store Connect', 'mobile'],
            ['Fastlane', 'mobile'],
            ['Model Context Protocol', 'ai'],
            ['OpenAI Agents SDK', 'ai'],
            ['Codex', 'developer-tools'],
            ['Google Antigravity', 'developer-tools'],
            ['macOS', 'operating-systems'],
            ['Linux', 'operating-systems'],
        ] as const) {
            assert.equal(findCatalogSkill(name)?.categoryKey, category, name)
        }
        assert.equal(findCatalogSkill('Cursor AI')?.name, 'Cursor')
        assert.equal(findCatalogSkill('OpenAI Codex')?.name, 'Codex')
        assert.equal(findCatalogSkill('Antigravity')?.name, 'Google Antigravity')
        assert.equal(findCatalogSkill('Linux')?.canonicalKey, 'devops.linux')
        assert.equal(findCatalogSkill('visionOS')?.canonicalKey, 'games.visionos')
    })

    it('detects a broad canonical repository stack without the former six-item ceiling', () => {
        const result = detectPackageTechnologies({
            dependencies: {
                next: 'latest', react: 'latest', typescript: 'latest', tailwindcss: 'latest',
                '@supabase/supabase-js': 'latest', 'drizzle-orm': 'latest', pg: 'latest',
                openai: 'latest', '@anthropic-ai/sdk': 'latest', '@playwright/test': 'latest',
                vite: 'latest', zustand: 'latest', '@tanstack/react-query': 'latest',
            },
        })
        assert.ok(result.technologies.length > 6)
        assert.equal(result.detectedFramework, 'Next.js')
        assert.ok(result.technologies.every((name) => findCatalogSkill(name)))

        const fileSignals = detectRepositoryFileTechnologies([
            '.github/workflows/check.yml', 'Dockerfile', 'docker-compose.yml', 'infra/main.tf', 'pnpm-lock.yaml',
        ])
        assert.deepEqual(fileSignals.slice(0, 5), ['Docker', 'Docker Compose', 'GitHub', 'GitHub Actions', 'Terraform'])
        assert.ok(fileSignals.every((name) => findCatalogSkill(name)))
    })
})
