import { and, eq, sql, or, inArray } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db";
import {
    connections,
    connectionSuggestions,
    connectionSuggestionDismissals,
    profiles,
    projects,
    projectOpenRoles
} from "@/lib/db/schema";
import { matchingSkillLabels } from "@/lib/skills/matching";

export const computeSocialGraphSuggestions = inngest.createFunction(
    { id: "social-graph-suggestions", retries: 1 },
    { event: "workspace/connections.sync_suggestions" },
    async ({ event, step }) => {
        const { userId } = event.data;

        // 1. Fetch user's active projects and their open roles for skill matching
        const myOpenRoles = await step.run("fetch-my-open-roles", async () => {
            return await db
                .select({
                    roleTitle: projectOpenRoles.title,
                    requiredSkills: projectOpenRoles.skills,
                })
                .from(projectOpenRoles)
                .innerJoin(projects, eq(projectOpenRoles.projectId, projects.id))
                .where(and(
                    eq(projects.ownerId, userId),
                    eq(projects.status, 'active')
                ));
        });

        const myProfile = await step.run("fetch-my-skills", async () => {
            const [p] = await db
                .select({ skills: profiles.skills })
                .from(profiles)
                .where(eq(profiles.id, userId))
                .limit(1);
            return p;
        });

        // 2. Base suggestions on 2nd-degree connections (mutual friends)
        const suggestions = await step.run("calculate-mutuals", async () => {
            const myConnections = await db
                .select({
                    id: sql<string>`CASE 
                        WHEN ${connections.requesterId} = ${userId} THEN ${connections.addresseeId} 
                        ELSE ${connections.requesterId} 
                    END`
                })
                .from(connections)
                .where(and(
                    eq(connections.status, 'accepted'),
                    or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId))
                ));

            const myConnIds = myConnections.map(c => c.id);
            if (myConnIds.length === 0) return [];

            const result = await db.execute(sql`
                WITH my_network AS (
                    SELECT unnest(${myConnIds}::uuid[]) as friend_id
                ),
                second_degree AS (
                    SELECT 
                        CASE 
                            WHEN c.requester_id = n.friend_id THEN c.addressee_id 
                            ELSE c.requester_id 
                        END as suggested_id,
                        count(*) as mutual_count
                    FROM connections c
                    JOIN my_network n ON (c.requester_id = n.friend_id OR c.addressee_id = n.friend_id)
                    WHERE c.status = 'accepted'
                    GROUP BY suggested_id
                )
                SELECT 
                    s.suggested_id,
                    p.username,
                    p.full_name,
                    p.skills as candidate_skills,
                    s.mutual_count::int as mutual_count
                FROM second_degree s
                JOIN profiles p ON s.suggested_id = p.id
                LEFT JOIN connections existing ON (
                    (existing.requester_id = ${userId} AND existing.addressee_id = s.suggested_id) OR
                    (existing.requester_id = s.suggested_id AND existing.addressee_id = ${userId})
                )
                LEFT JOIN connection_suggestion_dismissals dismissed ON (
                    dismissed.user_id = ${userId} AND dismissed.dismissed_profile_id = s.suggested_id
                )
                WHERE s.suggested_id != ${userId}
                  AND existing.id IS NULL
                  AND dismissed.id IS NULL
                ORDER BY s.mutual_count DESC
                LIMIT 100
            `);

            return Array.from(result);
        });

        if (suggestions.length === 0) return { suggestionsCount: 0 };

        // 3. Score and provide reasons (Skill overlap & Role alignment)
        const scoredSuggestions = await step.run("score-suggestions", async () => {
            return suggestions.map((s: any) => {
                let score = s.mutual_count * 10;
                let reason = `${s.mutual_count} mutual connections`;
                let roleMatched = false;
                const candidateSkills = (s.candidate_skills || []) as string[];

                // Project-Role Alignment matching
                for (const role of myOpenRoles) {
                    const roleSkills = role.requiredSkills || [];
                    const matches = matchingSkillLabels(candidateSkills, roleSkills);
                    if (matches.length > 0) {
                        score += 50;
                        reason = `Matches your open role: ${role.roleTitle}`;
                        roleMatched = true;
                        break;
                    }
                }

                // Generic Skill Overlap
                const overlappingSkills = matchingSkillLabels(candidateSkills, myProfile?.skills || []);
                const overlap = overlappingSkills.length;
                if (overlap > 0) {
                    score += overlap * 5;
                    if (!roleMatched) {
                        reason = `Skills overlap: ${overlappingSkills.slice(0, 2).join(", ")}`;
                    }
                }

                return {
                    userId,
                    suggestedUserId: s.suggested_id,
                    mutualConnectionsCount: s.mutual_count,
                    score,
                    reason,
                    updatedAt: new Date(),
                };
            });
        });

        // 4. Batch insert/update suggestions
        await step.run("upsert-suggestions", async () => {
            // Take top 50 by score
            const topSuggestions = scoredSuggestions
                .sort((a, b) => b.score - a.score)
                .slice(0, 50)
                .map(s => ({
                    ...s,
                    updatedAt: new Date(), // Re-create Date object here to avoid Inngest serialization string issue
                }));

            if (topSuggestions.length === 0) return;

            await db
                .insert(connectionSuggestions)
                .values(topSuggestions)
                .onConflictDoUpdate({
                    target: [connectionSuggestions.userId, connectionSuggestions.suggestedUserId],
                    set: {
                        mutualConnectionsCount: sql`excluded.mutual_connections_count`,
                        score: sql`excluded.score`,
                        reason: sql`excluded.reason`,
                        updatedAt: new Date(),
                    }
                });
        });

        return { suggestionsCount: scoredSuggestions.length };
    }
);
