import { asc, gt, inArray } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
    profileProjectContributions,
    profileProjectContributionStages,
    profiles,
    projectOpenRoles,
    projects,
} from '../src/lib/db/schema'
import {
    syncContributionSkills,
    syncProfileSkills,
    syncProjectSkills,
    syncRoleSkills,
} from '../src/lib/skills/service'

const APPLY = process.argv.includes('--apply')
const BATCH_SIZE = 100

type Stats = {
    profiles: number
    projects: number
    roles: number
    contributions: number
    labels: number
}

const stats: Stats = { profiles: 0, projects: 0, roles: 0, contributions: 0, labels: 0 }

function labels(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.map(String).map((entry) => entry.trim()).filter(Boolean)
}

async function forEachBatch<T extends { id: string }>(
    load: (cursor: string | null) => Promise<T[]>,
    visit: (row: T) => Promise<void>,
) {
    let cursor: string | null = null
    for (;;) {
        const rows = await load(cursor)
        if (rows.length === 0) return
        for (const row of rows) await visit(row)
        cursor = rows.at(-1)!.id
        if (rows.length < BATCH_SIZE) return
    }
}

async function backfillProfiles() {
    await forEachBatch(
        (cursor) => db.select({ id: profiles.id, skills: profiles.skills })
            .from(profiles)
            .where(cursor ? gt(profiles.id, cursor) : undefined)
            .orderBy(asc(profiles.id))
            .limit(BATCH_SIZE),
        async (profile) => {
            const source = labels(profile.skills)
            stats.profiles += 1
            stats.labels += source.length
            if (!APPLY) return
            await db.transaction(async (tx) => {
                const resolved = await syncProfileSkills(tx, profile.id, source)
                await tx.update(profiles).set({ skills: resolved.map((skill) => skill.name) }).where(inArray(profiles.id, [profile.id]))
            })
        },
    )
}

async function backfillProjects() {
    await forEachBatch(
        (cursor) => db.select({ id: projects.id, ownerId: projects.ownerId, skills: projects.skills })
            .from(projects)
            .where(cursor ? gt(projects.id, cursor) : undefined)
            .orderBy(asc(projects.id))
            .limit(BATCH_SIZE),
        async (project) => {
            const source = labels(project.skills)
            stats.projects += 1
            stats.labels += source.length
            if (!APPLY) return
            await db.transaction(async (tx) => {
                const resolved = await syncProjectSkills(tx, project.id, source, project.ownerId)
                await tx.update(projects).set({ skills: resolved.map((skill) => skill.name) }).where(inArray(projects.id, [project.id]))
            })
        },
    )
}

async function backfillRoles() {
    await forEachBatch(
        (cursor) => db.select({ id: projectOpenRoles.id, skills: projectOpenRoles.skills })
            .from(projectOpenRoles)
            .where(cursor ? gt(projectOpenRoles.id, cursor) : undefined)
            .orderBy(asc(projectOpenRoles.id))
            .limit(BATCH_SIZE),
        async (role) => {
            const source = labels(role.skills)
            stats.roles += 1
            stats.labels += source.length
            if (!APPLY) return
            await db.transaction(async (tx) => {
                const resolved = await syncRoleSkills(tx, role.id, source)
                await tx.update(projectOpenRoles).set({ skills: resolved.map((skill) => skill.name) }).where(inArray(projectOpenRoles.id, [role.id]))
            })
        },
    )
}

async function backfillContributions() {
    let cursor: string | null = null
    for (;;) {
        const rows = await db.select({
            id: profileProjectContributions.id,
            profileId: profileProjectContributions.profileId,
            skills: profileProjectContributions.skills,
        })
            .from(profileProjectContributions)
            .where(cursor ? gt(profileProjectContributions.id, cursor) : undefined)
            .orderBy(asc(profileProjectContributions.id))
            .limit(BATCH_SIZE)
        if (rows.length === 0) return

        const stages = await db.select({
            contributionId: profileProjectContributionStages.contributionId,
            skills: profileProjectContributionStages.skills,
        }).from(profileProjectContributionStages)
            .where(inArray(profileProjectContributionStages.contributionId, rows.map((row) => row.id)))
        const stageSkills = new Map<string, string[]>()
        for (const stage of stages) {
            const current = stageSkills.get(stage.contributionId) ?? []
            current.push(...labels(stage.skills))
            stageSkills.set(stage.contributionId, current)
        }

        for (const contribution of rows) {
            const source = [...new Set([
                ...labels(contribution.skills),
                ...(stageSkills.get(contribution.id) ?? []),
            ])]
            stats.contributions += 1
            stats.labels += source.length
            if (APPLY) {
                await db.transaction(async (tx) => {
                    const resolved = await syncContributionSkills(tx, contribution.id, source, contribution.profileId)
                    await tx.update(profileProjectContributions)
                        .set({ skills: resolved.map((skill) => skill.name) })
                        .where(inArray(profileProjectContributions.id, [contribution.id]))
                })
            }
        }
        cursor = rows.at(-1)!.id
        if (rows.length < BATCH_SIZE) return
    }
}

async function main() {
    console.log(`[skills] ${APPLY ? 'Applying' : 'Previewing'} canonical skill assignment backfill.`)
    await backfillProfiles()
    await backfillProjects()
    await backfillRoles()
    await backfillContributions()
    console.log('[skills] Backfill complete.', stats)
    if (!APPLY) console.log('[skills] Dry run only. Re-run with --apply after migrations 0103 and 0104 are applied.')
}

main().catch((error) => {
    console.error('[skills] Backfill failed.', error)
    process.exitCode = 1
})
