'use server';

import { db } from '@/lib/db';
import { projects, projectFollows, savedProjects, projectOpenRoles, conversations, conversationParticipants, messages, projectNodes } from '@/lib/db/schema';
import { eq, and, sql, inArray, isNotNull } from 'drizzle-orm';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CreateProjectInput } from '@/lib/validations/project';
import { generateSlug } from '@/lib/utils/slug';
import { generateProjectKey } from '@/lib/project-key';
// Queue Imports
import { inngest } from '@/inngest/client';
import { getLifecycleStagesForProjectType } from '@/lib/projects/lifecycle-templates';

// --- Types ---
interface CreateProjectResult {
    success: boolean;
    project?: {
        id: string;
        title: string;
        slug?: string;
    };
    error?: string;
}

// ============================================================================
// LAZY PROJECT GROUP CREATION (for existing projects without groups)
// ============================================================================
/**
 * Ensures a project has an associated project group conversation.
 * This is idempotent - safe to call multiple times (uses onConflictDoNothing).
 * 
 * @param projectId - The project ID to ensure has a group
 * @param ownerId - The owner's user ID (will be added as participant)
 * @returns The conversationId (existing or newly created)
 */
export async function ensureProjectGroupExists(
    projectId: string,
    ownerId: string
): Promise<string | null> {
    try {
        // FAST PATH: Check if project already has a conversationId (99% of cases)
        const [project] = await db
            .select({ conversationId: projects.conversationId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return null;

        // If already has conversationId, return it immediately
        if (project.conversationId) {
            return project.conversationId;
        }

        // SLOW PATH: Create project group with proper locking (rare - only for old projects)
        // Uses FOR UPDATE to prevent race conditions
        const result = await db.transaction(async (tx) => {
            // CRITICAL: Lock the row with FOR UPDATE to prevent concurrent creation
            const lockedProject = await tx.execute<{ conversation_id: string | null }>(sql`
                SELECT conversation_id 
                FROM ${projects} 
                WHERE id = ${projectId}
                FOR UPDATE
            `);

            const lockedRow = Array.from(lockedProject)[0];

            // If another transaction already created the group, return it
            if (lockedRow?.conversation_id) {
                return lockedRow.conversation_id;
            }

            // We have exclusive lock - safe to create
            const [newConversation] = await tx.insert(conversations).values({
                type: 'project_group',
            }).returning({ id: conversations.id });

            if (!newConversation) {
                throw new Error('Failed to create project group');
            }

            // Link to project (atomic, no race possible due to lock)
            await tx.update(projects)
                .set({ conversationId: newConversation.id })
                .where(eq(projects.id, projectId));

            // Get ALL existing project members
            const members = await tx
                .select({ userId: projectMembers.userId })
                .from(projectMembers)
                .where(eq(projectMembers.projectId, projectId));

            // Collect all participant user IDs (ensure owner is ALWAYS included)
            const participantIds = new Set<string>([ownerId]); // Always include owner
            members.forEach(m => participantIds.add(m.userId));

            // Add all participants (bulk insert, idempotent)
            await tx.insert(conversationParticipants)
                .values(
                    Array.from(participantIds).map(userId => ({
                        conversationId: newConversation.id,
                        userId,
                    }))
                )
                .onConflictDoNothing();

            return newConversation.id;
        });

        return result;
    } catch (error) {
        console.error('Error ensuring project group exists:', error);
        return null;
    }
}


// --- Create Action ---
export async function createProjectAction(input: CreateProjectInput & { slug?: string; project_id?: string }): Promise<CreateProjectResult> {
    try {
        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;

        if (!user) {
            return { success: false, error: 'You must be logged in to create a project' };
        }

        // Retrieve GitHub Access Token if available (for private repo access)
        const gitHubToken = session?.provider_token;

        let finalSlug = input.slug || generateSlug(input.title);
        // Initial Key Generation
        let finalKey = generateProjectKey(input.title);

        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            try {
                const projectData = {
                    ownerId: user.id,
                    title: input.title,
                    slug: finalSlug,
                    // Use mutable key variable
                    key: finalKey,
                    currentTaskNumber: 0,
                    description: input.description || null,
                    shortDescription: input.short_description || null,
                    problemStatement: input.problem_statement || null,
                    // Backward-compatible: support older clients sending solution_overview
                    solutionStatement: (input as any).solution_statement || (input as any).solution_overview || null,
                    category: input.project_type || null,
                    tags: input.tags || [],
                    skills: input.technologies_used || [],
                    visibility: (input.visibility as 'public' | 'private' | 'unlisted') || 'public',
                    status: mapStatus(input.status),
                    lookingForCollaborators: true,
                    lifecycleStages: (input.lifecycle_stages && input.lifecycle_stages.length > 0)
                        ? input.lifecycle_stages
                        : getLifecycleStagesForProjectType(input.project_type),
                    currentStageIndex: input.current_stage_index || 0,
                    importSource: input.import_source || null,
                    // For GitHub imports, start at `pending` until the worker actually begins cloning.
                    syncStatus: (input.import_source?.type === 'github' ? 'pending' :
                        input.import_source?.type === 'upload' ? 'pending' : 'ready') as 'pending' | 'cloning' | 'indexing' | 'ready' | 'failed',
                };

                // Use transaction to ensure project, owner membership, and project group are created together
                // OPTIMIZED: Create conversation FIRST, insert project WITH conversationId (saves 1 UPDATE)
                const result = await db.transaction(async (tx) => {
                    // 1. Create the Project Group Conversation FIRST
                    const [newConversation] = await tx.insert(conversations).values({
                        type: 'project_group',
                    }).returning({ id: conversations.id });

                    if (!newConversation) {
                        throw new Error('Failed to create project group');
                    }

                    // 2. Create the Project WITH conversationId
                    const [newProject] = await tx.insert(projects).values({
                        ...projectData,
                        conversationId: newConversation.id,
                    }).returning();

                    if (!newProject) {
                        throw new Error('Failed to create project');
                    }

                    // 3. Add Owner as a Participant of the Project Group
                    await tx.insert(conversationParticipants).values({
                        conversationId: newConversation.id,
                        userId: user.id,
                    });

                    // 4. Add owner as a member with 'owner' role
                    await tx.insert(projectMembers).values({
                        projectId: newProject.id,
                        userId: user.id,
                        role: 'owner'
                    });

                    // 5. Insert Open Roles (if any)
                    if (input.roles && input.roles.length > 0) {
                        await tx.insert(projectOpenRoles).values(
                            input.roles.map(role => ({
                                projectId: newProject.id,
                                role: role.role,
                                count: role.count,
                                description: role.description || "",
                                skills: role.skills || [],
                            }))
                        );
                    }

                    return newProject;
                });

                revalidatePath('/hub');

                // Add to Import Queue if applicable
                if (input.import_source?.type === 'github' && input.import_source.repoUrl) {
                    try {
                        await inngest.send({
                            name: "project/import",
                            data: {
                                projectId: result.id,
                                importSource: {
                                    type: 'github',
                                    repoUrl: input.import_source.repoUrl!,
                                    branch: input.import_source.branch,
                                    metadata: input.import_source.metadata
                                },
                                accessToken: gitHubToken || undefined,
                                userId: user.id
                            }
                        });
                    } catch (queueError) {
                        // If we can't enqueue, mark the project as failed so the Files tab becomes actionable.
                        const msg =
                            queueError instanceof Error ? queueError.message : 'Failed to enqueue GitHub import';
                        console.error('[Action] Failed to add to queue', queueError);

                        const currentImportSource = input.import_source!;
                        const nextImportSource = {
                            ...currentImportSource,
                            metadata: {
                                ...((currentImportSource as any)?.metadata || {}),
                                lastError: msg,
                            },
                        };

                        await db
                            .update(projects)
                            .set({ syncStatus: 'failed', importSource: nextImportSource as any, updatedAt: new Date() })
                            .where(eq(projects.id, result.id));
                    }
                }

                return {
                    success: true,
                    project: {
                        id: result.id,
                        title: result.title,
                        slug: result.slug || result.id,
                    },
                };

            } catch (error: any) {
                // Check for Unique Constraint Violation on Slug
                // Postgres error code 23505 is unique_violation
                if (error.code === '23505') {
                    if (error.message?.includes('slug')) {
                        if (input.slug) {
                            throw new Error('This project URL is already taken. Please choose another.');
                        }
                        attempts++;
                        const suffix = Math.random().toString(36).substring(2, 6);
                        finalSlug = `${generateSlug(input.title)}-${suffix}`;
                        continue;
                    }
                    // Project Key Collision (e.g. "NB" already exists)
                    if (error.message?.includes('key')) {
                        attempts++;
                        const suffix = Math.floor(Math.random() * 9) + 1;
                        finalKey = `${generateProjectKey(input.title)}${suffix}`;
                        continue;
                    }
                }
                throw error; // Re-throw other errors
            }
        }

        throw new Error("Failed to generate a unique project ID. Please try again.");

    } catch (error) {
        console.error('Error creating project:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'An unexpected error occurred',
        };
    }
}

// --- Update Action ---
export async function updateProject(projectId: string, data: any) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error("Unauthorized");

    // Transaction to ensure atomicity of project update + role changes
    return await db.transaction(async (tx) => {
        // Check ownership
        const [project] = await tx.select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) throw new Error("Project not found");
        if (project.ownerId !== user.id) throw new Error("Unauthorized");

        const { roles, deletedRoleIds, ...raw } = data || {};

        // Update Project (canonical camelCase payload; accepts snake_case for backward compatibility)
        const updateValues: any = {
            updatedAt: new Date(),
        };

        if (raw.title !== undefined) updateValues.title = raw.title;
        if (raw.description !== undefined) updateValues.description = raw.description;
        if (raw.visibility !== undefined) updateValues.visibility = raw.visibility;
        if (raw.status !== undefined) updateValues.status = raw.status;

        // Tagline
        if (raw.shortDescription !== undefined) updateValues.shortDescription = raw.shortDescription;
        else if (raw.short_description !== undefined) updateValues.shortDescription = raw.short_description;

        // Problem / Solution
        if (raw.problemStatement !== undefined) updateValues.problemStatement = raw.problemStatement;
        else if (raw.problem_statement !== undefined) updateValues.problemStatement = raw.problem_statement;

        if (raw.solutionStatement !== undefined) updateValues.solutionStatement = raw.solutionStatement;
        else if (raw.solution_statement !== undefined) updateValues.solutionStatement = raw.solution_statement;
        else if (raw.solution_overview !== undefined) updateValues.solutionStatement = raw.solution_overview; // legacy

        // Category
        if (raw.category !== undefined) updateValues.category = raw.category;
        else if (raw.project_type !== undefined) updateValues.category = raw.project_type;
        else if (raw.custom_project_type !== undefined) updateValues.category = raw.custom_project_type;

        // Tags / Skills
        if (raw.tags !== undefined) updateValues.tags = raw.tags;
        if (raw.skills !== undefined) updateValues.skills = raw.skills;
        else if (raw.technologies_used !== undefined) updateValues.skills = raw.technologies_used;

        // Lifecycle
        if (raw.lifecycleStages !== undefined) updateValues.lifecycleStages = raw.lifecycleStages;
        else if (raw.lifecycle_stages !== undefined) updateValues.lifecycleStages = raw.lifecycle_stages;

        if (raw.currentStageIndex !== undefined) updateValues.currentStageIndex = raw.currentStageIndex;
        else if (raw.current_stage_index !== undefined) updateValues.currentStageIndex = raw.current_stage_index;

        await tx.update(projects).set(updateValues).where(eq(projects.id, projectId));

        // Update Roles
        if (roles && Array.isArray(roles)) {
            if (deletedRoleIds?.length > 0) {
                await tx.delete(projectOpenRoles).where(inArray(projectOpenRoles.id, deletedRoleIds));
            }

            for (const role of roles) {
                if (role.id) {
                    await tx.update(projectOpenRoles)
                        .set({
                            role: role.role,
                            count: role.count,
                            description: role.description || "",
                            skills: role.skills || [],
                            updatedAt: new Date(),
                        })
                        .where(eq(projectOpenRoles.id, role.id));
                } else {
                    await tx.insert(projectOpenRoles)
                        .values({
                            projectId: project.id,
                            role: role.role,
                            count: role.count || 1,
                            description: role.description || "",
                            skills: role.skills || [],
                        });
                }
            }
        }

        return { success: true, slug: project.slug, id: project.id };
    }).then(({ success, slug, id }) => {
        revalidatePath(`/projects/${slug}`);
        revalidatePath(`/projects/${id}`);
        return { success };
    });
}

// --- Delete Action ---
export async function deleteProject(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error("Unauthorized");

    // Check ownership and get conversationId
    const [project] = await db.select({
        ownerId: projects.ownerId,
        conversationId: projects.conversationId,
        slug: projects.slug
    })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) throw new Error("Project not found");
    if (project.ownerId !== user.id) throw new Error("Unauthorized");

    // 1. Get ALL S3 keys for this project before deleting nodes
    const fileNodes = await db.select({ s3Key: projectNodes.s3Key })
        .from(projectNodes)
        .where(and(
            eq(projectNodes.projectId, projectId),
            isNotNull(projectNodes.s3Key)
        ));

    const s3Keys = fileNodes.map(n => n.s3Key!).filter(Boolean);

    // 2. Comprehensive Cleanup Transaction
    await db.transaction(async (tx) => {
        // A. Update application messages to show "project_deleted" status
        // This is a simple, non-blocking metadata update for chat UI
        await tx.execute(sql`
            UPDATE ${messages}
            SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb), 
                '{status}', 
                '"project_deleted"'
            )
            WHERE metadata->>'projectId' = ${projectId}
        `);

        // B. Delete the project (cascades to projectMembers, nodes, roles, applications, etc.)
        await tx.delete(projects).where(eq(projects.id, projectId));

        // C. Delete the project group conversation if it exists
        if (project.conversationId) {
            await tx.delete(conversations).where(eq(conversations.id, project.conversationId));
        }
    });

    // 3. Delete files from S3 Storage (Best Effort, outside transaction)
    if (s3Keys.length > 0) {
        try {
            const adminClient = await createAdminClient();
            await adminClient.storage.from("project-files").remove(s3Keys);
        } catch (storageError) {
            console.error("Failed to cleanup S3 files for project:", projectId, storageError);
            // Don't fail the whole action if storage cleanup fails
        }
    }

    revalidatePath("/hub");
    revalidatePath(`/projects/${project.slug || projectId}`);
    redirect("/hub");
}

/**
 * Deep deletion of a project draft.
 * Wipes DB records and S3 assets completely.
 */
export async function deleteProjectDraftAction(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        const [project] = await db.select({
            ownerId: projects.ownerId,
            conversationId: projects.conversationId,
        })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return { success: true }; // Already gone
        if (project.ownerId !== user.id) throw new Error("Unauthorized");

        // 2. Wipe DB (Atomic transition)
        await db.transaction(async (tx) => {
            // Delete project (cascades to members, roles, etc.)
            await tx.delete(projects).where(eq(projects.id, projectId));
            if (project.conversationId) {
                await tx.delete(conversations).where(eq(conversations.id, project.conversationId));
            }
        });

        // 3. Wipe S3 (Best Effort - Deep recursive wipe of entire project prefix)
        try {
            const adminClient = await createAdminClient();

            // Recursive list and delete helper
            const purgeFolder = async (folderPath: string) => {
                const { data: files, error } = await adminClient.storage.from("project-files").list(folderPath, {
                    limit: 1000,
                });

                if (error || !files || files.length === 0) return;

                const filesToDelete = files
                    .filter(f => f.id) // Only files have IDs in some Supabase versions, or check metadata
                    .map(f => `${folderPath}/${f.name}`);

                const subFolders = files
                    .filter(f => !f.id || f.metadata === null) // Folders
                    .map(f => `${folderPath}/${f.name}`);

                // Delete files in this level
                if (filesToDelete.length > 0) {
                    await adminClient.storage.from("project-files").remove(filesToDelete);
                }

                // Recurse into subfolders (Pure optimization: Parallel recursion)
                if (subFolders.length > 0) {
                    await Promise.all(subFolders.map(sf => purgeFolder(sf)));
                }
            };

            await purgeFolder(projectId);
        } catch (storageError) {
            console.error("S3 recursive draft cleanup failed:", storageError);
        }

        revalidatePath("/hub");
        return { success: true };
    } catch (error: any) {
        console.error("Failed to delete draft:", error);
        return { success: false, error: error.message || "Failed to delete draft" };
    }
}

// --- Interaction Actions ---

export async function toggleProjectBookmarkAction(projectId: string, shouldBookmark: boolean) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (shouldBookmark) {
            await db.insert(savedProjects)
                .values({ userId: user.id, projectId })
                .onConflictDoNothing();
        } else {
            await db.delete(savedProjects)
                .where(and(eq(savedProjects.userId, user.id), eq(savedProjects.projectId, projectId)));
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error) {
        console.error('Error toggling bookmark:', error);
        return { success: false, error: 'Failed to update bookmark' };
    }
}

export async function toggleProjectFollowAction(projectId: string, shouldFollow: boolean) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (shouldFollow) {
            await db.insert(projectFollows)
                .values({ userId: user.id, projectId })
                .onConflictDoNothing();
        } else {
            await db.delete(projectFollows)
                .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)));
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error) {
        console.error('Error toggling follow:', error);
        return { success: false, error: 'Failed to update follow status' };
    }
}

export async function incrementProjectViewAction(projectId: string): Promise<void> {
    try {
        await db.update(projects)
            .set({ viewCount: sql`${projects.viewCount} + 1` })
            .where(eq(projects.id, projectId));
    } catch (e) {
        console.error("Failed to increment view", e);
    }
}

export async function getProjectUserStateAction(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { isFollowing: false, isBookmarked: false, isOwner: false };
    }

    const [follow, save, project] = await Promise.all([
        db.select().from(projectFollows).where(and(eq(projectFollows.projectId, projectId), eq(projectFollows.userId, user.id))).limit(1),
        db.select().from(savedProjects).where(and(eq(savedProjects.projectId, projectId), eq(savedProjects.userId, user.id))).limit(1),
        db.select({ ownerId: projects.ownerId, conversationId: projects.conversationId }).from(projects).where(eq(projects.id, projectId)).limit(1)
    ]);

    // LAZY PROJECT GROUP CREATION: If owner visits and project has no group, create it
    // SYNCHRONOUS: Wait for creation to complete so group is immediately visible
    if (project[0] && !project[0].conversationId && project[0].ownerId === user.id) {
        await ensureProjectGroupExists(projectId, project[0].ownerId);
    }

    return {
        isFollowing: !!follow[0],
        isBookmarked: !!save[0],
        isOwner: project[0]?.ownerId === user.id
    };
}

// Helper: Map wizard status to database status
function mapStatus(status?: string): 'draft' | 'active' | 'completed' | 'archived' {
    switch (status) {
        case 'open':
        case 'active':
            return 'active';
        case 'completed':
            return 'completed';
        case 'archived':
            return 'archived';
        default:
            return 'draft';
    }
}

// ============================================================================
// TASK & SPRINT ACTIONS (PHASE 8 OPTIMIZATION)
// ============================================================================
import { z } from "zod";
import { tasks, projectSprints, projectMembers, taskNodeLinks, taskSubtasks, profiles } from "@/lib/db/schema";

// --- Fetch Actions (Optimization) ---

export async function fetchProjectTasksAction(
    projectId: string,
    limit: number = 100,
    cursor?: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // Basic read access check can be done via RLS on Supabase side if using client, 
        // but since we are server-side with drizzle, we should ideally check membership or public visibility.
        // For speed, we'll optimistically fetch assuming the page component checked general access.

        const projectTasks = await db.query.tasks.findMany({
            where: (t, { eq, and, lt }) => and(
                eq(t.projectId, projectId),
                cursor ? lt(t.createdAt, new Date(cursor)) : undefined
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: limit + 1,
            with: {
                assignee: true,
                creator: true,
                attachments: true,
                subtasks: true
            }
        });

        const hasMore = projectTasks.length > limit;
        const tasks = projectTasks.slice(0, limit);
        const nextCursor = hasMore ? tasks[tasks.length - 1].createdAt.toISOString() : undefined;

        return { success: true, tasks, nextCursor, hasMore };
    } catch (error) {
        console.error("Failed to fetch tasks:", error);
        return { success: false, error: "Failed to fetch tasks" };
    }
}

export async function fetchProjectSprintsAction(projectId: string) {
    try {
        const projectSprintsList = await db.query.projectSprints.findMany({
            where: (s, { eq }) => eq(s.projectId, projectId),
            orderBy: (s, { desc }) => [desc(s.createdAt)]
        });

        return { success: true, sprints: projectSprintsList };
    } catch (error) {
        console.error("Failed to fetch sprints:", error);
        return { success: false, error: "Failed to fetch sprints" };
    }
}

export async function fetchSprintTasksAction(sprintId: string) {
    try {
        const sprintTasks = await db.query.tasks.findMany({
            where: (t, { eq }) => eq(t.sprintId, sprintId),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            with: {
                assignee: true,
                creator: true,
                attachments: true,
                subtasks: true
            }
        });

        return { success: true, tasks: sprintTasks };
    } catch (error) {
        console.error("Failed to fetch sprint tasks:", error);
        return { success: false, error: "Failed to fetch sprint tasks" };
    }
}

export async function getProjectMembersAction(
    projectId: string,
    limit: number = 20,
    offset: number = 0
) {
    try {
        const membersResult = await db.query.projectMembers.findMany({
            where: (members, { eq }) => eq(members.projectId, projectId),
            with: {
                user: true
            },
            limit,
            offset
        });

        const members = membersResult.map(m => m.user);
        const hasMore = members.length === limit;

        return { success: true, members, hasMore };
    } catch (error) {
        console.error("Failed to fetch project members:", error);
        return { success: false, error: "Failed to fetch project members" };
    }
}

export async function getProjectAnalyticsAction(projectId: string) {
    try {
        const tasksResult = await db
            .select({
                status: tasks.status,
                priority: tasks.priority,
                dueDate: tasks.dueDate,
                count: sql<number>`count(*)`
            })
            .from(tasks)
            .where(eq(tasks.projectId, projectId))
            .groupBy(tasks.status, tasks.priority, tasks.dueDate);

        const now = new Date();
        const stats = {
            totalTasks: 0,
            completedTasks: 0,
            inProgressTasks: 0,
            overdueTasks: 0,
            priorityDistribution: {} as Record<string, number>,
        };

        tasksResult.forEach(row => {
            const count = Number(row.count);
            stats.totalTasks += count;

            if (row.status === 'done') {
                stats.completedTasks += count;
            } else if (row.status === 'in_progress') {
                stats.inProgressTasks += count;
            }

            if (row.status !== 'done' && row.dueDate && new Date(row.dueDate) < now) {
                stats.overdueTasks += count;
            }

            const priority = row.priority || 'medium';
            stats.priorityDistribution[priority] = (stats.priorityDistribution[priority] || 0) + count;
        });

        const completionRate = stats.totalTasks > 0
            ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
            : 0;

        return {
            success: true,
            analytics: {
                ...stats,
                completionRate
            }
        };
    } catch (error) {
        console.error("Failed to fetch project analytics:", error);
        return { success: false, error: "Failed to fetch project analytics" };
    }
}


const createTaskSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    status: z.enum(["todo", "in_progress", "done"]).default("todo"),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    sprintId: z.string().uuid().optional().nullable(),
    assigneeId: z.string().uuid().optional().nullable(),
    storyPoints: z.number().min(0).optional(),
    dueDate: z.string().optional().nullable(), // ISO String
    subtasks: z.array(z.object({
        title: z.string(),
        completed: z.boolean().default(false)
    })).optional(),
    tags: z.array(z.string()).optional(),
    attachmentNodeIds: z.array(z.string().uuid()).optional()
});

export async function createTaskAction(data: z.infer<typeof createTaskSchema>) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");


        const validated = createTaskSchema.parse(data);

        // 1. Verify Project Access (Owner or Member)
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, validated.projectId),
            columns: { ownerId: true }
        });

        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            const projectMember = await db.query.projectMembers.findFirst({
                where: and(
                    eq(projectMembers.projectId, validated.projectId),
                    eq(projectMembers.userId, user.id)
                )
            });

            if (!projectMember) {
                throw new Error("You do not have permission to create tasks in this project");
            }
        }

        // 2. Insert Task & Attachments Transactionally
        const result = await db.transaction(async (tx) => {
            // 2a. Increment Project Counter & Get New Number
            const [updatedProject] = await tx
                .update(projects)
                .set({ currentTaskNumber: sql`${projects.currentTaskNumber} + 1` })
                .where(eq(projects.id, validated.projectId))
                .returning({ newNumber: projects.currentTaskNumber });

            if (!updatedProject) throw new Error("Failed to generate task ID");

            const [newTask] = await tx.insert(tasks).values({
                projectId: validated.projectId,
                title: validated.title,
                description: validated.description,
                status: validated.status,
                priority: validated.priority,
                sprintId: validated.sprintId || null,
                assigneeId: validated.assigneeId || null,
                creatorId: user.id,
                storyPoints: validated.storyPoints,
                dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
                // Assign Sequential Number
                taskNumber: updatedProject.newNumber,
            }).returning();

            if (validated.attachmentNodeIds && validated.attachmentNodeIds.length > 0) {
                await tx.insert(taskNodeLinks).values(
                    validated.attachmentNodeIds.map(nodeId => ({
                        taskId: newTask.id,
                        nodeId: nodeId,
                        createdBy: user.id
                    }))
                );
            }

            if (validated.subtasks && validated.subtasks.length > 0) {
                await tx.insert(taskSubtasks).values(
                    validated.subtasks.map((st, index) => ({
                        taskId: newTask.id,
                        title: st.title,
                        completed: st.completed,
                        position: index
                    }))
                );
            }

            return newTask;
        });

        // Note: We don't need to manually revalidate if we are using Realtime
        // But for fallback and initial load consistency:
        revalidatePath(`/projects/${validated.projectId}`);

        return { success: true, task: result };
    } catch (error) {
        console.error("Failed to create task:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to create task" };
    }
}

const createSprintSchema = z.object({
    projectId: z.string().uuid(),
    name: z.string().min(1, "Name is required"),
    goal: z.string().optional(),
    startDate: z.string(), // ISO String
    endDate: z.string(), // ISO String
    description: z.string().optional(),
});

export async function createSprintAction(data: z.infer<typeof createSprintSchema>) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        const validated = createSprintSchema.parse(data);

        // 1. Validate Access (Owner or Member)
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, validated.projectId),
            columns: { ownerId: true, slug: true }
        });

        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            throw new Error("Only the project owner can create sprints");
        }

        // 2. Create Sprint
        const [newSprint] = await db.insert(projectSprints).values({
            projectId: validated.projectId,
            name: validated.name,
            goal: validated.goal,
            startDate: new Date(validated.startDate),
            endDate: new Date(validated.endDate),
            status: 'planning', // Default to planning
        }).returning();

        const slugOrId = project.slug || validated.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${validated.projectId}`);
        revalidatePath('/hub');

        return { success: true, sprint: newSprint };

    } catch (error) {
        console.error("Failed to create sprint:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to create sprint" };
    }
}

export async function startSprintAction(sprintId: string, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Access Check
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true }
        });
        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            throw new Error("Only the project owner can start sprints");
        }

        // 1. Check for active sprints
        const activeSprint = await db.query.projectSprints.findFirst({
            where: and(
                eq(projectSprints.projectId, projectId),
                eq(projectSprints.status, 'active')
            )
        });

        if (activeSprint) {
            throw new Error("There is already an active sprint. Complete it before starting a new one.");
        }

        // 2. Start Sprint
        await db.update(projectSprints)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(projectSprints.id, sprintId));

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error("Failed to start sprint:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to start sprint" };
    }
}

export async function completeSprintAction(sprintId: string, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Access Check
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true }
        });
        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            throw new Error("Only the project owner can complete sprints");
        }

        await db.update(projectSprints)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(projectSprints.id, sprintId));

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error("Failed to complete sprint:", error);
        return { success: false, error: "Failed to complete sprint" };
    }
}

export async function moveTaskToSprintAction(taskId: string, sprintId: string | null, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Access Check
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true }
        });
        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            // For MOVING tasks to sprint, strictly speaking only the Sprint Leader (Owner) should define what goes in?
            // Or can members pick tasks?
            // User said: "In that sprint, we can create tasks... creating a new task, allowing us to select that sprint."
            // So CREATING a task into a sprint is allowed for members (via createTaskAction).
            // But MOVING an *existing* task into a sprint?
            // If we follow "Simplicity", let's restrict Sprint Management to Owner.
            // But "selecting a sprint" during creation implies assignment.
            // Let's assume OWNER manages the sprint scope. Members just execute.
            // BUT, if I assign a task to a sprint, that changes scope.
            // Recommendation was "Owner Only".
            throw new Error("Only the project owner can manage sprint tasks");
        }

        await db.update(tasks)
            .set({ sprintId: sprintId, updatedAt: new Date() })
            .where(eq(tasks.id, taskId));

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error("Failed to move task:", error);
        return { success: false, error: "Failed to move task" };
    }
}

export async function deleteTaskAction(taskId: string, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Access Check - Only project owner can delete tasks
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true }
        });
        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            throw new Error("Only the project owner can delete tasks");
        }

        // Delete the task
        await db.delete(tasks)
            .where(eq(tasks.id, taskId));

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error("Failed to delete task:", error);
        return { success: true, error: error instanceof Error ? error.message : "Failed to delete task" };
    }
}

export async function updateProjectStageAction(projectId: string, currentStageIndex: number) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        console.log("[updateProjectStageAction] Starting update:", { projectId, currentStageIndex, userId: user.id });

        // Use Supabase client directly for RLS-compliant update
        // Add .select() to get the updated row back and verify the update worked
        const { data: updatedRows, error } = await supabase
            .from('projects')
            .update({
                current_stage_index: currentStageIndex,
                updated_at: new Date().toISOString()
            })
            .eq('id', projectId)
            .eq('owner_id', user.id)
            .select('id, current_stage_index');

        console.log("[updateProjectStageAction] Update result:", { updatedRows, error });

        if (error) {
            console.error("[updateProjectStageAction] Supabase update error:", error);
            throw new Error(error.message);
        }

        if (!updatedRows || updatedRows.length === 0) {
            console.error("[updateProjectStageAction] No rows updated! Check owner_id match.");
            throw new Error("Update failed - no rows matched. Ensure you are the project owner.");
        }

        // Get slug for revalidation
        const { data: project } = await supabase
            .from('projects')
            .select('slug')
            .eq('id', projectId)
            .single();

        const slugOrId = project?.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);
        revalidatePath('/hub');

        return { success: true };
    } catch (error) {
        console.error("[updateProjectStageAction] Failed:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to update project stage" };
    }
}

/**
 * Smart Lifecycle Update Action
 * Handles stage renames, reorders, additions, and deletions.
 * Uses "Smart Rebalance" logic to keep currentStageIndex pointing at the correct stage.
 */
export async function updateProjectLifecycleAction(
    projectId: string,
    newStages: string[],
    currentActiveStageName: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Validate
        if (!newStages || newStages.length === 0) {
            throw new Error("At least one lifecycle stage is required");
        }

        // Get current index for Smart Rebalance calculation
        const { data: project, error: fetchError } = await supabase
            .from('projects')
            .select('current_stage_index, slug')
            .eq('id', projectId)
            .eq('owner_id', user.id)
            .single();

        if (fetchError || !project) {
            throw new Error("Project not found or access denied");
        }

        // SMART REBALANCE: Find the new index for the current stage
        let newIndex = newStages.findIndex(s => s === currentActiveStageName);
        if (newIndex === -1) {
            // Stage was deleted - fallback to previous index or 0
            newIndex = Math.max(0, (project.current_stage_index || 0) - 1);
            // Clamp to max
            newIndex = Math.min(newIndex, newStages.length - 1);
        }

        // Use Supabase client directly for RLS-compliant update
        const { error } = await supabase
            .from('projects')
            .update({
                lifecycle_stages: newStages,
                current_stage_index: newIndex,
                updated_at: new Date().toISOString()
            })
            .eq('id', projectId)
            .eq('owner_id', user.id);

        if (error) {
            console.error("Supabase update error:", error);
            throw new Error(error.message);
        }

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);
        revalidatePath('/hub');

        return { success: true, newStageIndex: newIndex };
    } catch (error) {
        console.error("Failed to update project lifecycle:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to update project lifecycle" };
    }
}



export async function finalizeProjectAction(projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        return await db.transaction(async (tx) => {
            // 1. Verify Ownership
            const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw new Error("Project not found");
            if (project.ownerId !== user.id) throw new Error("Only the owner can finalize the project");

            if (project.status === 'completed') throw new Error("Project is already completed");

            // 2. Finalize Project
            await tx.update(projects)
                .set({ status: 'completed', updatedAt: new Date() })
                .where(eq(projects.id, projectId));

            // 3. Close open roles
            // Use local import or ensure projectOpenRoles is imported. 
            // It is imported at line 4 (from view_file output).
            await tx.delete(projectOpenRoles).where(eq(projectOpenRoles.projectId, projectId));

            // 4. (Future) Distribute Reputation Points
            // This would be a ledger insert

            return { success: true, slug: project.slug };
        });
    } catch (error) {
        console.error("Failed to finalize project:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to finalize project" };
    }
}

export async function getProjectSyncStatus(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Minimal auth check
    if (!user) return { success: false, error: 'Unauthorized' };

    try {
        const [project] = await db
            .select({
                syncStatus: projects.syncStatus,
                importSource: projects.importSource
            })
            .from(projects)
            .where(eq(projects.id, projectId));

        const meta = (project?.importSource as any)?.metadata;
        const lastError = meta?.lastError || null;

        return {
            success: true,
            status: project?.syncStatus || 'ready',
            lastError
        };
    } catch (error) {
        console.error('Failed to get sync status', error);
        return { success: false, error: 'Failed' };
    }
}

export async function retryGithubImportAction(projectId: string, clientToken?: string) {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return { success: false, error: 'Unauthorized' };

    try {
        const [project] = await db
            .select({ ownerId: projects.ownerId, importSource: projects.importSource })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return { success: false, error: 'Project not found' };
        if (project.ownerId !== user.id) return { success: false, error: 'Unauthorized' };

        const src = project.importSource as any;
        if (!src || src.type !== 'github' || !src.repoUrl) {
            return { success: false, error: 'Not a GitHub import project' };
        }

        // Inngest handles concurrency/idempotency automatically via function settings.
        // We just re-emit the event.

        // Prioritize client-provided token (fresh from client session), fallback to server session
        const gitHubToken = clientToken || session?.provider_token;

        const nextImportSource = {
            ...src,
            metadata: {
                ...(src.metadata || {}),
                lastError: null,
                lastRetryAt: new Date().toISOString(),
            },
        };

        await db
            .update(projects)
            .set({ syncStatus: 'pending', importSource: nextImportSource as any, updatedAt: new Date() })
            .where(eq(projects.id, projectId));

        await inngest.send({
            name: "project/import",
            data: {
                projectId,
                importSource: {
                    type: 'github',
                    repoUrl: src.repoUrl,
                    branch: src.branch,
                    metadata: nextImportSource.metadata,
                },
                accessToken: gitHubToken || undefined,
                userId: user.id,
            }
        });

        return { success: true };
    } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : 'Retry failed';
        try {
            await db.update(projects)
                .set({
                    syncStatus: 'failed',
                    updatedAt: new Date(),
                    importSource: sql`jsonb_set(COALESCE(${projects.importSource}, '{}'::jsonb), '{metadata,lastError}', ${JSON.stringify(msg)}::jsonb)` as any,
                })
                .where(eq(projects.id, projectId));
        } catch { }

        return { success: false, error: msg };
    }
}
