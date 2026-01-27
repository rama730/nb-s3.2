'use server';

import { db } from '@/lib/db';
import { projects, projectFollows, savedProjects, projectOpenRoles } from '@/lib/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CreateProjectInput } from '@/lib/validations/project';
import { generateSlug } from '@/lib/utils/slug';

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

// --- Create Action ---
export async function createProjectAction(input: CreateProjectInput & { slug?: string; project_id?: string }): Promise<CreateProjectResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'You must be logged in to create a project' };
        }

        const finalSlug = input.slug || generateSlug(input.title);

        const projectData = {
            ownerId: user.id,
            title: input.title,
            slug: finalSlug,
            description: input.description || null,
            shortDescription: input.short_description || null,
            category: input.project_type || null,
            tags: input.tags || [],
            skills: input.technologies_used || [],
            visibility: (input.visibility as 'public' | 'private' | 'unlisted') || 'public',
            status: mapStatus(input.status),
            lookingForCollaborators: true,
            lifecycleStages: (input.lifecycle_stages && input.lifecycle_stages.length > 0)
                ? input.lifecycle_stages
                : ["Concept", "Team Formation", "MVP", "Beta", "Launch"],
            currentStageIndex: input.current_stage_index || 0,
        };

        // Use transaction to ensure project and owner membership are created together
        const result = await db.transaction(async (tx) => {
            const [newProject] = await tx.insert(projects).values(projectData).returning();

            if (!newProject) {
                throw new Error('Failed to create project');
            }

            // Add owner as a member with 'owner' role
            await tx.insert(projectMembers).values({
                projectId: newProject.id,
                userId: user.id,
                role: 'owner'
            });

            return newProject;
        });

        revalidatePath('/hub');

        return {
            success: true,
            project: {
                id: result.id,
                title: result.title,
                slug: result.slug || result.id,
            },
        };
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

        const { roles, deletedRoleIds, ...projectData } = data;

        // Update Project
        await tx.update(projects)
            .set({
                ...projectData,
                lifecycleStages: projectData.lifecycle_stages,
                currentStageIndex: projectData.current_stage_index,
                problemStatement: projectData.problem_statement,
                solutionStatement: projectData.solution_statement,
                shortDescription: projectData.short_description,
                updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));

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

    // Check ownership
    const [project] = await db.select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) throw new Error("Project not found");
    if (project.ownerId !== user.id) throw new Error("Unauthorized");

    await db.delete(projects).where(eq(projects.id, projectId));

    revalidatePath("/hub");
    redirect("/hub");
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
        db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1)
    ]);

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
import { tasks, projectSprints, projectMembers } from "@/lib/db/schema";

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
    tags: z.array(z.string()).optional()
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

        // 2. Insert Task
        const [newTask] = await db.insert(tasks).values({
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
        }).returning();

        // Note: We don't need to manually revalidate if we are using Realtime
        // But for fallback and initial load consistency:
        revalidatePath(`/projects/${validated.projectId}`);

        return { success: true, task: newTask };
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
        return { success: false, error: error instanceof Error ? error.message : "Failed to delete task" };
    }
}
