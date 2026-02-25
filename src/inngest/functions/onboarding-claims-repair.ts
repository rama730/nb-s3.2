import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { inngest } from '../client'
import { db } from '@/lib/db'
import { onboardingEvents, onboardingSubmissions, profiles } from '@/lib/db/schema'
import { createClient } from '@supabase/supabase-js'

const REPAIR_BATCH_SIZE = 100

export const onboardingClaimsRepair = inngest.createFunction(
    { id: 'onboarding-claims-repair', retries: 1 },
    { cron: '0 * * * *' },
    async () => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !serviceRoleKey) {
            return { scanned: 0, repaired: 0, skipped: 0, reason: 'missing-service-role-env' }
        }
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        })
        const candidates = await db
            .select({
                submissionId: onboardingSubmissions.id,
                userId: onboardingSubmissions.userId,
            })
            .from(onboardingSubmissions)
            .where(
                and(
                    eq(onboardingSubmissions.status, 'completed'),
                    isNull(onboardingSubmissions.claimsRepairedAt),
                )
            )
            .orderBy(asc(onboardingSubmissions.updatedAt))
            .limit(REPAIR_BATCH_SIZE)

        if (candidates.length === 0) {
            return { scanned: 0, repaired: 0, skipped: 0 }
        }

        const userIds = Array.from(new Set(candidates.map((item) => item.userId)))
        const submissionIdsByUser = new Map<string, string[]>()
        for (const candidate of candidates) {
            const existing = submissionIdsByUser.get(candidate.userId) || []
            existing.push(candidate.submissionId)
            submissionIdsByUser.set(candidate.userId, existing)
        }
        const profileRows = await db
            .select({
                userId: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(
                and(
                    inArray(profiles.id, userIds),
                    isNotNull(profiles.username)
                )
            )

        let repaired = 0
        let skipped = 0
        const profileUserIdSet = new Set(profileRows.map((profile) => profile.userId))
        const missingUserIds = userIds.filter((userId) => !profileUserIdSet.has(userId))

        if (missingUserIds.length > 0) {
            const missingSubmissionIds = missingUserIds.flatMap(
                (userId) => submissionIdsByUser.get(userId) || []
            )
            if (missingSubmissionIds.length > 0) {
                await db
                    .update(onboardingSubmissions)
                    .set({
                        claimsRepairedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            inArray(onboardingSubmissions.id, missingSubmissionIds),
                            isNull(onboardingSubmissions.claimsRepairedAt),
                        )
                    )
            }
            skipped += missingUserIds.length
        }

        for (const profile of profileRows) {
            const submissionIds = submissionIdsByUser.get(profile.userId) || []
            if (submissionIds.length === 0) {
                continue
            }

            const userResult = await supabase.auth.admin.getUserById(profile.userId)
            if (userResult.error) {
                console.error('[onboarding-claims-repair] Failed to load auth user', {
                    userId: profile.userId,
                    error: userResult.error.message,
                })
                skipped += 1
                continue
            }
            const authUser = userResult.data.user
            if (!authUser) {
                skipped += 1
                continue
            }

            const existingMetadata = authUser.user_metadata || {}
            const expectedUsername = profile.username ?? null
            const expectedFullName = profile.fullName ?? null
            const expectedAvatar = profile.avatarUrl ?? null

            const needsUpdate =
                (existingMetadata.username ?? null) !== expectedUsername ||
                (existingMetadata.full_name ?? null) !== expectedFullName ||
                (existingMetadata.avatar_url ?? null) !== expectedAvatar ||
                (existingMetadata.onboarded ?? null) !== true

            let metadataReconciled = false
            if (!needsUpdate) {
                skipped += 1
                metadataReconciled = true
            } else {
                const updateResult = await supabase.auth.admin.updateUserById(profile.userId, {
                    user_metadata: {
                        ...existingMetadata,
                        onboarded: true,
                        username: expectedUsername,
                        full_name: expectedFullName,
                        avatar_url: expectedAvatar,
                    },
                })

                if (updateResult.error) {
                    skipped += 1
                    continue
                }

                repaired += 1
                metadataReconciled = true
                try {
                    await db.insert(onboardingEvents).values({
                        userId: profile.userId,
                        eventType: 'claims_repair_success',
                        step: 4,
                        metadata: {},
                    })
                } catch (eventInsertError) {
                    console.error('[onboarding-claims-repair] Failed to insert success event', {
                        userId: profile.userId,
                        error: eventInsertError instanceof Error ? eventInsertError.message : String(eventInsertError),
                    })
                }
            }

            if (!metadataReconciled) {
                continue
            }

            await db
                .update(onboardingSubmissions)
                .set({
                    claimsRepairedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        inArray(onboardingSubmissions.id, submissionIds),
                        isNull(onboardingSubmissions.claimsRepairedAt),
                    )
                )
        }

        return {
            scanned: candidates.length,
            repaired,
            skipped,
        }
    }
)
