import { createHash } from 'node:crypto'
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
    profileContributionSkills,
    profileSkills,
    projectSkills,
    roleSkills,
    skillAliases,
    skillCategories,
    skillProposals,
    skills,
} from '@/lib/db/schema'
import { findCatalogSkill, searchMarketSkills, SKILL_CATALOG_VERSION } from './catalog'
import { getGeneratedSkillIcon, toSkillSummary } from './presentation'
import { normalizeSkillInputList, normalizeSkillLookup, skillSlug } from './normalization'
import type { SkillKind, SkillMarketTier, SkillSearchResult, SkillSummary } from './types'
import { canonicalizeSkillLabels } from './matching'

type SkillDbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>

export type ResolvedSkill = {
    id: string
    name: string
    canonicalKey: string
    status: 'active' | 'deprecated' | 'merged' | 'hidden' | 'pending'
}

function customIdentity(label: string) {
    const normalized = normalizeSkillLookup(label)
    const digest = createHash('sha256').update(normalized).digest('hex')
    const readable = skillSlug(label).slice(0, 48) || 'skill'
    return {
        canonicalKey: `custom.${digest.slice(0, 24)}`,
        slug: `custom-${readable}-${digest.slice(0, 8)}`,
    }
}

async function categoryIdFor(executor: SkillDbExecutor, categoryKey: string): Promise<string | null> {
    const [category] = await executor
        .select({ id: skillCategories.id })
        .from(skillCategories)
        .where(eq(skillCategories.key, categoryKey))
        .limit(1)
    return category?.id ?? null
}

export async function resolveSkillsForWrite(
    executor: SkillDbExecutor,
    labels: readonly string[],
    submittedBy?: string | null,
): Promise<ResolvedSkill[]> {
    const normalized = canonicalizeSkillLabels(normalizeSkillInputList(labels))
    if (normalized.length === 0) return []

    // 1. In-memory prepare catalog and custom identities
    const targets = normalized.map((label) => {
        const catalog = findCatalogSkill(label)
        const custom = catalog ? null : customIdentity(label)
        const canonicalKey = catalog?.canonicalKey ?? custom!.canonicalKey
        const slug = catalog?.slug ?? custom!.slug
        return {
            label,
            catalog,
            custom,
            canonicalKey,
            slug,
        }
    })

    const canonicalKeys = targets.map((t) => t.canonicalKey)
    const slugs = targets.map((t) => t.slug)
    const lowerNames = targets.map((t) => t.label.toLowerCase())

    // 2. Fetch all matching skills and their aliases in one SELECT query
    const matchedRows = await executor
        .select({
            id: skills.id,
            name: skills.name,
            slug: skills.slug,
            canonicalKey: skills.canonicalKey,
            status: skills.status,
            catalogVersion: skills.catalogVersion,
            aliasNormalized: skillAliases.normalizedAlias,
        })
        .from(skills)
        .leftJoin(skillAliases, eq(skillAliases.skillId, skills.id))
        .where(
            or(
                inArray(skills.canonicalKey, canonicalKeys),
                inArray(sql`lower(${skills.name})`, lowerNames),
                inArray(skills.slug, slugs),
                inArray(skillAliases.normalizedAlias, lowerNames.map((n) => normalizeSkillLookup(n)))
            )
        )

    // Group matched rows by skill attributes to de-duplicate the join results
    const existingMapByCanonical = new Map<string, typeof matchedRows[number]>()
    const existingMapByName = new Map<string, typeof matchedRows[number]>()
    const existingMapBySlug = new Map<string, typeof matchedRows[number]>()
    const existingMapByAlias = new Map<string, typeof matchedRows[number]>()

    for (const row of matchedRows) {
        if (row.canonicalKey) existingMapByCanonical.set(row.canonicalKey.toLowerCase(), row)
        if (row.name) existingMapByName.set(row.name.toLowerCase(), row)
        if (row.slug) existingMapBySlug.set(row.slug.toLowerCase(), row)
        if (row.aliasNormalized) existingMapByAlias.set(row.aliasNormalized.toLowerCase(), row)
    }

    // 3. Resolve each target against matching rows
    const resolvedSkills: ResolvedSkill[] = []
    const skillsToInsert: any[] = []
    const skillsToUpdate: Array<{ id: string; set: any }> = []
    const categoryCache = new Map<string, string | null>()

    for (const target of targets) {
        // Find existing match
        const existing =
            existingMapByCanonical.get(target.canonicalKey.toLowerCase()) ??
            existingMapByName.get(target.label.toLowerCase()) ??
            existingMapBySlug.get(target.slug.toLowerCase()) ??
            existingMapByAlias.get(normalizeSkillLookup(target.label))

        if (existing) {
            resolvedSkills.push({
                id: existing.id,
                name: existing.name,
                canonicalKey: existing.canonicalKey,
                status: existing.status,
            })

            // If it's a catalog skill, check if it needs update (e.g. catalogVersion mismatch)
            if (target.catalog && existing.catalogVersion !== SKILL_CATALOG_VERSION) {
                // Fetch category ID (can cache in-memory)
                let categoryId = categoryCache.get(target.catalog.categoryKey)
                if (categoryId === undefined) {
                    categoryId = await categoryIdFor(executor, target.catalog.categoryKey)
                    categoryCache.set(target.catalog.categoryKey, categoryId)
                }
                const icon = getGeneratedSkillIcon(target.catalog.canonicalKey)
                skillsToUpdate.push({
                    id: existing.id,
                    set: {
                        canonicalKey: target.catalog.canonicalKey,
                        name: target.catalog.name,
                        slug: target.catalog.slug,
                        categoryId,
                        kind: target.catalog.kind,
                        iconSource: icon?.source ?? target.catalog.iconSource,
                        iconKey: icon?.assetKey ?? target.catalog.iconKey,
                        brandColor: icon?.brandColor ?? target.catalog.brandColor,
                        marketTier: target.catalog.marketTier,
                        status: 'active' as const,
                        selectable: true,
                        catalogVersion: SKILL_CATALOG_VERSION,
                        lastReviewedAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
            }
        } else {
            // Needs insertion
            let categoryId = null
            if (target.catalog) {
                let cachedId = categoryCache.get(target.catalog.categoryKey)
                if (cachedId === undefined) {
                    cachedId = await categoryIdFor(executor, target.catalog.categoryKey)
                    categoryCache.set(target.catalog.categoryKey, cachedId)
                }
                categoryId = cachedId
            }

            const icon = target.catalog ? getGeneratedSkillIcon(target.catalog.canonicalKey) : null
            const identity = target.catalog ?? {
                canonicalKey: target.canonicalKey,
                name: target.label,
                slug: target.slug,
                kind: 'competency' as const,
                marketTier: 'extended' as const,
                iconSource: 'monogram' as const,
                iconKey: 'badge',
                brandColor: null,
            }

            skillsToInsert.push({
                canonicalKey: identity.canonicalKey,
                name: identity.name,
                slug: identity.slug,
                categoryId,
                kind: identity.kind,
                iconSource: icon?.source ?? identity.iconSource,
                iconKey: icon?.assetKey ?? identity.iconKey,
                brandColor: icon?.brandColor ?? identity.brandColor,
                marketTier: identity.marketTier,
                status: target.catalog ? ('active' as const) : ('pending' as const),
                selectable: true,
                sourceMetadata: target.catalog ? { source: 'nb-market-catalog' } : { source: 'user-proposal' },
                catalogVersion: target.catalog ? SKILL_CATALOG_VERSION : 'custom',
                lastReviewedAt: target.catalog ? new Date() : null,
                updatedAt: new Date(),
            })
        }
    }

    // 4. Perform batch inserts and updates
    if (skillsToInsert.length > 0) {
        const inserted = await executor
            .insert(skills)
            .values(skillsToInsert)
            .onConflictDoNothing()
            .returning({ id: skills.id, name: skills.name, canonicalKey: skills.canonicalKey, status: skills.status })

        // Add inserted skills to resolved output
        resolvedSkills.push(...inserted)

        // For any conflicts that onConflictDoNothing skipped, we query them to ensure we return them
        if (inserted.length < skillsToInsert.length) {
            const missingKeys = skillsToInsert
                .filter((toInsert) => !inserted.some((ins) => ins.canonicalKey.toLowerCase() === toInsert.canonicalKey.toLowerCase()))
                .map((toInsert) => toInsert.canonicalKey)

            if (missingKeys.length > 0) {
                const fetched = await executor
                    .select({ id: skills.id, name: skills.name, canonicalKey: skills.canonicalKey, status: skills.status })
                    .from(skills)
                    .where(inArray(skills.canonicalKey, missingKeys))
                resolvedSkills.push(...fetched)
            }
        }
    }

    if (skillsToUpdate.length > 0) {
        for (const update of skillsToUpdate) {
            await executor
                .update(skills)
                .set(update.set)
                .where(eq(skills.id, update.id))
        }
    }

    // 5. Batch insert aliases in a single query
    const aliasesToInsert: any[] = []
    for (const resolved of resolvedSkills) {
        const catalog = findCatalogSkill(resolved.name)
        const aliases = catalog ? [catalog.name, ...catalog.aliases] : [resolved.name]
        for (const alias of aliases) {
            const normalizedAlias = normalizeSkillLookup(alias)
            if (!normalizedAlias) continue
            aliasesToInsert.push({
                skillId: resolved.id,
                alias,
                normalizedAlias,
                locale: 'en',
                source: catalog ? 'catalog' : 'user',
                isPreferred: alias === resolved.name,
            })
        }
    }

    if (aliasesToInsert.length > 0) {
        await executor.insert(skillAliases).values(aliasesToInsert).onConflictDoNothing()
    }

    // 6. Batch insert proposals in a single query
    if (submittedBy) {
        const proposalsToInsert: any[] = []
        for (const resolved of resolvedSkills) {
            const catalog = findCatalogSkill(resolved.name)
            if (!catalog) {
                proposalsToInsert.push({
                    submittedBy,
                    label: resolved.name,
                    normalizedLabel: normalizeSkillLookup(resolved.name),
                    context: 'assignment',
                    status: 'pending',
                    resolvedSkillId: resolved.id,
                    updatedAt: new Date(),
                })
            }
        }
        if (proposalsToInsert.length > 0) {
            await executor.insert(skillProposals).values(proposalsToInsert).onConflictDoNothing()
        }
    }

    return resolvedSkills
}

export async function syncProfileSkills(
    executor: SkillDbExecutor,
    profileId: string,
    labels: readonly string[],
): Promise<ResolvedSkill[]> {
    const resolved = await resolveSkillsForWrite(executor, labels, profileId)
    await executor.delete(profileSkills).where(eq(profileSkills.profileId, profileId))
    if (resolved.length > 0) {
        await executor.insert(profileSkills).values(resolved.map((skill, displayOrder) => ({
            profileId,
            skillId: skill.id,
            displayOrder,
            isPrimary: displayOrder < 3,
            visibility: 'public' as const,
            updatedAt: new Date(),
        })))
    }
    return resolved
}

export async function syncProjectSkills(
    executor: SkillDbExecutor,
    projectId: string,
    labels: readonly string[],
    submittedBy?: string | null,
): Promise<ResolvedSkill[]> {
    const resolved = await resolveSkillsForWrite(executor, labels, submittedBy)
    await executor.delete(projectSkills).where(eq(projectSkills.projectId, projectId))
    if (resolved.length > 0) {
        await executor.insert(projectSkills).values(resolved.map((skill, displayOrder) => ({
            projectId,
            skillId: skill.id,
            displayOrder,
            usageKind: displayOrder < 3 ? 'primary' as const : 'used' as const,
            updatedAt: new Date(),
        })))
    }
    return resolved
}

export async function syncRoleSkills(
    executor: SkillDbExecutor,
    roleId: string,
    labels: readonly string[],
    submittedBy?: string | null,
): Promise<ResolvedSkill[]> {
    const resolved = await resolveSkillsForWrite(executor, labels, submittedBy)
    await executor.delete(roleSkills).where(eq(roleSkills.roleId, roleId))
    if (resolved.length > 0) {
        await executor.insert(roleSkills).values(resolved.map((skill, displayOrder) => ({
            roleId,
            skillId: skill.id,
            displayOrder,
            requirement: 'required' as const,
            updatedAt: new Date(),
        })))
    }
    return resolved
}

export async function syncContributionSkills(
    executor: SkillDbExecutor,
    contributionId: string,
    labels: readonly string[],
    submittedBy?: string | null,
): Promise<ResolvedSkill[]> {
    const resolved = await resolveSkillsForWrite(executor, labels, submittedBy)
    await executor.delete(profileContributionSkills).where(eq(profileContributionSkills.contributionId, contributionId))
    if (resolved.length > 0) {
        await executor.insert(profileContributionSkills).values(resolved.map((skill, displayOrder) => ({
            contributionId,
            skillId: skill.id,
            displayOrder,
            updatedAt: new Date(),
        })))
    }
    return resolved
}

/**
 * Resolves a contribution batch once, then replaces every contribution/skill
 * edge in two statements. This keeps the relational skill table authoritative
 * without the N x catalog-query loop used by the legacy profile JSON sync.
 */
export async function syncContributionSkillsBatch(
    executor: SkillDbExecutor,
    entries: readonly { contributionId: string; labels: readonly string[] }[],
    submittedBy?: string | null,
): Promise<Map<string, ResolvedSkill[]>> {
    const contributionIds = Array.from(new Set(entries.map((entry) => entry.contributionId)))
    if (contributionIds.length === 0) return new Map()

    const allLabels = canonicalizeSkillLabels(entries.flatMap((entry) => [...entry.labels]))
    const resolved = await resolveSkillsForWrite(executor, allLabels, submittedBy)
    const byCanonicalKey = new Map(resolved.map((skill) => [skill.canonicalKey.toLowerCase(), skill]))
    const byName = new Map(resolved.map((skill) => [normalizeSkillLookup(skill.name), skill]))
    const result = new Map<string, ResolvedSkill[]>()

    const rows = entries.flatMap((entry) => {
        const seen = new Set<string>()
        const contributionSkills = canonicalizeSkillLabels(entry.labels).flatMap((label) => {
            const catalog = findCatalogSkill(label)
            const identity = catalog?.canonicalKey ?? customIdentity(label).canonicalKey
            const skill = byCanonicalKey.get(identity.toLowerCase()) ?? byName.get(normalizeSkillLookup(label))
            if (!skill || seen.has(skill.id)) return []
            seen.add(skill.id)
            return [skill]
        })
        result.set(entry.contributionId, contributionSkills)
        return contributionSkills.map((skill, displayOrder) => ({
            contributionId: entry.contributionId,
            skillId: skill.id,
            displayOrder,
            updatedAt: new Date(),
        }))
    })

    await executor.delete(profileContributionSkills).where(inArray(profileContributionSkills.contributionId, contributionIds))
    if (rows.length > 0) {
        await executor.insert(profileContributionSkills).values(rows)
    }
    return result
}

export async function searchSkillCatalog(input: {
    query?: string
    category?: string | null
    kind?: SkillKind | null
    tier?: SkillMarketTier | null
    limit?: number
}): Promise<SkillSearchResult[]> {
    const staticResults: SkillSearchResult[] = searchMarketSkills(input).map((skill): SkillSearchResult => {
        const icon = getGeneratedSkillIcon(skill.canonicalKey)
        return {
            ...skill,
            iconSource: icon?.source ?? skill.iconSource,
            iconKey: icon?.assetKey ?? skill.iconKey,
            brandColor: icon?.brandColor ?? skill.brandColor,
            status: 'active' as const,
            replacementSkillId: null,
        }
    })
    if (!input.query?.trim() || staticResults.length >= (input.limit ?? 30)) return staticResults

    try {
        const remaining = Math.max(0, Math.min(30, input.limit ?? 30) - staticResults.length)
        const customRows = await db
            .select({
                id: skills.id,
                canonicalKey: skills.canonicalKey,
                name: skills.name,
                slug: skills.slug,
                kind: skills.kind,
                marketTier: skills.marketTier,
                iconSource: skills.iconSource,
                iconKey: skills.iconKey,
                brandColor: skills.brandColor,
                status: skills.status,
                categoryKey: skillCategories.key,
            })
            .from(skills)
            .leftJoin(skillCategories, eq(skillCategories.id, skills.categoryId))
            .where(and(
                eq(skills.selectable, true),
                inArray(skills.status, ['active', 'deprecated']),
                ilike(skills.name, `%${input.query.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`),
            ))
            .orderBy(asc(skills.name))
            .limit(remaining)

        const seen = new Set(staticResults.map((skill) => skill.canonicalKey))
        for (const row of customRows) {
            if (seen.has(row.canonicalKey)) continue
            staticResults.push({
                id: row.id,
                canonicalKey: row.canonicalKey,
                name: row.name,
                slug: row.slug,
                categoryKey: row.categoryKey ?? 'human',
                kind: row.kind,
                marketTier: row.marketTier,
                iconSource: row.iconSource,
                iconKey: row.iconKey,
                brandColor: row.brandColor,
                status: row.status,
                replacementSkillId: null,
                score: 1,
                matchedAlias: null,
            })
        }
    } catch {
        // Static catalog remains available during additive migration rollout.
    }
    return staticResults
}

export function summarizeSkillLabels(labels: readonly string[]): SkillSummary[] {
    return normalizeSkillInputList(labels).map((label) => {
        const catalog = findCatalogSkill(label)
        if (catalog) return toSkillSummary(catalog)
        const identity = customIdentity(label)
        return {
            canonicalKey: identity.canonicalKey,
            name: label,
            slug: identity.slug,
            categoryKey: 'human',
            kind: 'competency',
            marketTier: 'extended',
            iconSource: 'monogram',
            iconKey: 'badge',
            brandColor: null,
            status: 'pending',
            replacementSkillId: null,
        }
    })
}
