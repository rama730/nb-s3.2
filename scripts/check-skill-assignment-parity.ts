import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { SKILL_CATALOG_VERSION } from '../src/lib/skills/catalog'

type ParityRow = {
    catalog_skills: number | string
    catalog_categories: number | string
    catalog_icons: number | string
    profile_mismatches: number | string
    project_mismatches: number | string
    role_mismatches: number | string
    contribution_mismatches: number | string
    express_alias_matches: number | string
}

async function main() {
    const result = await db.execute<ParityRow>(sql`
        SELECT
          (SELECT count(*) FROM skills WHERE catalog_version = ${SKILL_CATALOG_VERSION} AND status = 'active') AS catalog_skills,
          (SELECT count(*) FROM skill_categories WHERE status = 'active') AS catalog_categories,
          (SELECT count(*) FROM skill_icon_assets WHERE approval_status = 'catalog_approved') AS catalog_icons,
          (SELECT count(*) FROM profiles owner WHERE jsonb_array_length(COALESCE(owner.skills, '[]'::jsonb)) <>
            (SELECT count(*) FROM profile_skills assignment WHERE assignment.profile_id = owner.id)) AS profile_mismatches,
          (SELECT count(*) FROM projects owner WHERE jsonb_array_length(COALESCE(owner.skills, '[]'::jsonb)) <>
            (SELECT count(*) FROM project_skills assignment WHERE assignment.project_id = owner.id)) AS project_mismatches,
          (SELECT count(*) FROM project_open_roles owner WHERE jsonb_array_length(COALESCE(owner.skills, '[]'::jsonb)) <>
            (SELECT count(*) FROM role_skills assignment WHERE assignment.role_id = owner.id)) AS role_mismatches,
          (SELECT count(*) FROM profile_project_contributions owner WHERE jsonb_array_length(COALESCE(owner.skills, '[]'::jsonb)) >
          (SELECT count(*) FROM profile_contribution_skills assignment WHERE assignment.contribution_id = owner.id)) AS contribution_mismatches,
          (SELECT count(*) FROM skill_aliases alias INNER JOIN skills skill ON skill.id = alias.skill_id
            WHERE alias.normalized_alias = 'express js' AND skill.canonical_key = 'backend.express') AS express_alias_matches
    `)
    const row = Array.from(result)[0]
    if (!row) throw new Error('Skill parity query returned no result')

    const snapshot = {
        catalog_skills: Number(row.catalog_skills),
        catalog_categories: Number(row.catalog_categories),
        catalog_icons: Number(row.catalog_icons),
        profile_mismatches: Number(row.profile_mismatches),
        project_mismatches: Number(row.project_mismatches),
        role_mismatches: Number(row.role_mismatches),
        contribution_mismatches: Number(row.contribution_mismatches),
        express_alias_matches: Number(row.express_alias_matches),
    }
    const failures: string[] = []
    if (snapshot.catalog_skills < 900) failures.push(`catalog skills below floor: ${snapshot.catalog_skills}`)
    if (snapshot.catalog_categories < 22) failures.push(`catalog categories below floor: ${snapshot.catalog_categories}`)
    if (snapshot.catalog_icons < 475) failures.push(`approved icons below floor: ${snapshot.catalog_icons}`)
    for (const key of ['profile_mismatches', 'project_mismatches', 'role_mismatches', 'contribution_mismatches'] as const) {
        if (snapshot[key] !== 0) failures.push(`${key}: ${snapshot[key]}`)
    }
    if (snapshot.express_alias_matches !== 1) failures.push('Express.js alias is not canonical')

    if (failures.length > 0) {
        console.error('[skills] Assignment parity failed:', failures)
        process.exitCode = 1
        return
    }
    console.log('[skills] Assignment parity valid.', snapshot)
}

main().catch((error) => {
    console.error('[skills] Assignment parity check failed.', error)
    process.exitCode = 1
})
