import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('skills ecosystem contract', () => {
    it('keeps catalog schema, RLS, current seed data, and compatibility joins together', () => {
        const schema = source('drizzle/0103_market_skill_catalog.sql')
        const seed = source('drizzle/0117_market_skill_catalog_1_3_6.sql')

        for (const table of [
            'skill_categories', 'skill_aliases', 'skill_icon_assets',
            'skill_proposals', 'role_skills', 'profile_contribution_skills',
        ]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`))
        assert.match(schema, /Role skills are publicly readable/)
        assert.match(schema, /Visible contribution skills are readable/)
        assert.match(source('drizzle/0106_role_skill_visibility_hardening.sql'), /Visible role skills are readable/)
        assert.match(seed, /Catalog release 1\.3\.6/)
        assert.match(seed, /simple-icons','devicon','skill-icons','logos','developer-icons','lucide','custom/)
        const generator = source('scripts/generate-skill-catalog.ts')
        assert.equal(generator.includes(`skill_${'catalog'}_releases`), false)
        assert.equal(generator.includes(`skill_${'relationships'}`), false)
        assert.match(source('drizzle/0109_skill_catalog_fk_indexes.sql'), /skills_replacement_skill_id_idx/)
        assert.match(source('drizzle/0109_skill_catalog_fk_indexes.sql'), /profile_contribution_skills_verified_by_idx/)
    })

    it('tracks every supplied icon repository and blocks unlicensed artwork', () => {
        const registry = source('src/lib/skills/icon-sources.ts')
        for (const repository of [
            'tandpfun/skill-icons', 'devicons/devicon', 'simple-icons/simple-icons',
            'YuheshPandian/ICONIC', 'marwin1991/profile-technology-icons', 'gilbarbara/logos',
            'get-icon/geticon', 'xandemon/developer-icons', 'glincker/thesvg',
        ]) assert.match(registry, new RegExp(repository.replace('/', '\\/')))
        assert.match(registry, /id: 'profile-technology-icons'[\s\S]{0,240}license: null[\s\S]{0,160}integration: 'discovery-only'/)
        assert.match(source('scripts/generate-skill-catalog.ts'), /skillIconsCollection|logosCollection|developerIconSvg/)
    })

    it('routes all assignment owners through the canonical write service', () => {
        const service = source('src/lib/skills/service.ts')
        const profile = source('src/app/actions/profile.ts')
        const onboarding = source('src/app/actions/onboarding.ts')
        const project = source('src/app/actions/project/_all.ts')
        const collaboration = source('src/lib/profile/collaboration.ts')

        for (const functionName of ['syncProfileSkills', 'syncProjectSkills', 'syncRoleSkills', 'syncContributionSkills']) {
            assert.match(service, new RegExp(`export async function ${functionName}`))
        }
        assert.match(profile, /syncProfileSkills/)
        assert.match(onboarding, /syncProfileSkills/)
        assert.match(project, /syncProjectSkills/)
        assert.match(project, /syncRoleSkills/)
        assert.match(collaboration, /syncContributionSkills/)
    })

    it('uses one reusable icon, chip, list, and picker presentation layer', () => {
        const surfaces = [
            'src/components/onboarding/steps/Step3Skills.tsx',
            'src/components/profile/edit/EditProfileTabs.tsx',
            'src/components/profile/v2/sections/SkillsCard.tsx',
            'src/components/projects/EditProjectModal.tsx',
            'src/components/projects/create-wizard/phases/Phase2Information.tsx',
            'src/components/projects/settings/ProjectRolesEditor.tsx',
        ]
        for (const file of surfaces) assert.match(source(file), /SkillPicker|SkillList|SkillChip/)

        const icon = source('src/components/skills/SkillIcon.tsx')
        assert.match(icon, /\/skill-icons\/v1\//)
        assert.match(icon, /resolveSkillIconThemeVariant/)
        assert.match(icon, /GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS/)
        assert.doesNotMatch(icon, /lowLuminanceBrand|dark:\[--skill-icon-render-color/)
        assert.doesNotMatch(icon, /drop-shadow|dark:bg-white|dark:ring-white|bg-white\/80/)
        assert.doesNotMatch(icon, /<img|https?:\/\//)
        assert.match(icon, /IDENTITY_FALLBACK_KINDS/)
        assert.match(icon, /SPRITE_UNSAFE_LOCAL_IMAGE_KEYS/)
        assert.match(icon, /curated-google-antigravity/)
        assert.match(source('src/components/skills/SkillChip.tsx'), /SkillIcon/)
        assert.match(source('src/components/skills/SkillChip.tsx'), /resolveClientSkill/)
        assert.match(source('src/components/projects/ProjectCard.tsx'), /MAX_PROJECT_CARD_SKILL_ICONS = 10/)
        assert.match(source('src/components/projects/ProjectCard.tsx'), /SkillIcon/)
        assert.match(source('src/components/projects/ProjectCard.tsx'), /resolveClientSkill/)
        assert.match(source('src/components/projects/ProjectCard.tsx'), /\+{hiddenTechStackCount}/)
        assert.doesNotMatch(source('src/components/projects/ProjectCard.tsx'), /h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100/)
        assert.doesNotMatch(source('src/components/projects/ProjectCard.tsx'), /techStack\.map/)
    })

    it('preserves brand colors across themes and limits switching to reviewed monochrome pairs', () => {
        const policy = source('src/lib/skills/icon-theme-policy.ts')
        const generator = source('scripts/generate-skill-catalog.ts')

        for (const iconKey of ['apple', 'logos-apple', 'logos-anthropic-icon', 'logos-openai-icon']) {
            assert.match(policy, new RegExp(`['\"]?${iconKey.replaceAll('-', '\\-')}['\"]?`))
        }
        assert.match(policy, /official-monochrome-pair/)
        assert.match(policy, /SKILL_SEMANTIC_ICON_ONLY = new Set\(\['WebSockets'\]\)/)
        assert.match(generator, /\['original', 'plain', 'line'/)
        assert.doesNotMatch(source('scripts/skill-icons/curated/codex-openai.svg'), /currentColor|#111111/)
        assert.match(source('scripts/skill-icons/curated/codex-openai.svg'), /#478BFF/)
        assert.match(source('scripts/skill-icons/curated/antigravity-google.svg'), /linearGradient/)
    })

    it('keeps the profile skill catalog visible before search focus', () => {
        const picker = source('src/components/skills/SkillPicker.tsx')
        assert.match(picker, /aria-label="Available skills"/)
        assert.match(picker, /aria-expanded="true"/)
        assert.match(picker, /min-h-40 max-h-72/)
        assert.doesNotMatch(picker, /setOpen|\{open \?/)
    })

    it('uses one canonical repository detector and keeps project detection above six results', () => {
        const detector = source('src/lib/skills/repository-detection.ts')
        assert.match(detector, /MAX_DETECTED_REPOSITORY_SKILLS = 24/)
        assert.match(detector, /Chrome Extension API|GitHub|Docker Compose/)
        assert.match(source('src/app/actions/github.ts'), /detectPackageTechnologies/)
        assert.match(source('src/lib/upload/analyze-folder.ts'), /detectRepositoryFileTechnologies/)
        assert.doesNotMatch(source('src/app/actions/github.ts'), /technologies\.slice\(0, 6\)/)
        assert.doesNotMatch(source('src/lib/upload/analyze-folder.ts'), /technologies\.slice\(0, 6\)/)
    })

    it('keeps discovery and project ranking on canonical matching helpers', () => {
        assert.match(source('src/components/people/PersonCard.tsx'), /matchingSkillLabels/)
        assert.match(source('src/inngest/functions/social-graph-suggestions.ts'), /matchingSkillLabels/)
        assert.match(source('src/lib/data/hub.ts'), /countCanonicalSkillMatches/)
    })

    it('keeps catalog traffic observable without logging search text', () => {
        const searchRoute = source('src/app/api/v1/skills/route.ts')
        const proposalRoute = source('src/app/api/v1/skills/proposals/route.ts')
        assert.match(searchRoute, /skills\.catalog\.search/)
        assert.doesNotMatch(searchRoute, /logger\.metric\([\s\S]{0,180}\bquery\b/)
        assert.match(proposalRoute, /skills\.proposal\.submitted/)
    })

    it('ships an idempotent, batched legacy backfill and an integrity release gate', () => {
        const backfill = source('scripts/backfill-market-skills.ts')
        const gate = source('scripts/check-skill-catalog.ts')
        const packageJson = source('package.json')

        assert.match(backfill, /BATCH_SIZE = 100/)
        assert.match(backfill, /--apply/)
        assert.match(backfill, /db\.transaction/)
        assert.match(gate, /checksum mismatch/)
        assert.match(gate, /unsafe SVG content/)
        assert.match(gate, /one complete SVG document/)
        assert.match(gate, /viewBox-sized canvas background/)
        assert.match(gate, /cannot be rendered as a valid SVG/)
        assert.match(gate, /SKILL_SEMANTIC_ICON_KEYS/)
        assert.match(source('scripts/generate-skill-catalog.ts'), /devicon|CURATED_ICONS/)
        assert.match(packageJson, /check:skills:catalog/)
        assert.match(packageJson, /check:skills:assignments/)
    })
})
