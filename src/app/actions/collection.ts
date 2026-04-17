"use server";

import { db } from "@/lib/db";
import { collections, collectionProjects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/async/inflight-dedupe";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProjectAccessById } from "@/lib/data/project-access";

const addProjectsInputSchema = z.object({
    collectionId: z.string().uuid(),
    projectIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function createCollectionAction(name: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Unauthorized" };
        }

        const [newCollection] = await db.insert(collections).values({
            name,
            ownerId: user.id,
        }).returning();

        revalidatePath('/hub');
        return { success: true, collection: newCollection };
    } catch (error: any) {
        console.error("Failed to create collection:", error);
        return { success: false, error: error?.message || "Failed to create collection" };
    }
}

export async function getUserCollectionsAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Unauthorized" };
        }
        return await runInFlightDeduped(`collections:user:${user.id}`, async () => {
            const userCollections = await db.query.collections.findMany({
                where: eq(collections.ownerId, user.id),
                with: {
                    projects: {
                        columns: {
                            projectId: true,
                        }
                    }
                },
                orderBy: (collections, { desc }) => [desc(collections.createdAt)],
            });

            return { success: true, collections: userCollections };
        });
    } catch (error: any) {
        console.error("Failed to get collections:", error);
        return { success: false, error: error?.message || "Failed to fetch collections" };
    }
}

export async function addProjectsToCollectionAction(collectionId: string, projectIds: string[]) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Unauthorized" };
        }

        const validated = addProjectsInputSchema.parse({
            collectionId,
            projectIds,
        });

        // Verify ownership
        const [collection] = await db.select().from(collections)
            .where(and(eq(collections.id, validated.collectionId), eq(collections.ownerId, user.id)))
            .limit(1);

        if (!collection) {
            return { success: false, error: "Collection not found or unauthorized" };
        }

        const accessByProject = await Promise.all(
            validated.projectIds.map(async (projectId) => ({
                projectId,
                access: await getProjectAccessById(projectId, user.id),
            }))
        );
        const readableProjectIds = accessByProject
            .filter(({ access }) => access.canRead)
            .map(({ projectId }) => projectId);

        if (!readableProjectIds.length) {
            return { success: false, error: "No readable projects were provided" };
        }

        const values = readableProjectIds.map(projectId => ({
            collectionId: validated.collectionId,
            projectId,
        }));

        await db.insert(collectionProjects)
            .values(values)
            .onConflictDoNothing({ target: [collectionProjects.collectionId, collectionProjects.projectId] });

        revalidatePath('/hub');
        return { success: true };
    } catch (error: any) {
        console.error("Failed to add projects to collection:", error);
        return { success: false, error: error?.message || "Failed to add projects" };
    }
}

export async function removeProjectFromCollectionAction(collectionId: string, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Unauthorized" };
        }

        const [collection] = await db.select().from(collections)
            .where(and(eq(collections.id, collectionId), eq(collections.ownerId, user.id)))
            .limit(1);

        if (!collection) {
            return { success: false, error: "Collection not found or unauthorized" };
        }

        await db.delete(collectionProjects)
            .where(and(
                eq(collectionProjects.collectionId, collectionId),
                eq(collectionProjects.projectId, projectId)
            ));

        revalidatePath('/hub');
        return { success: true };
    } catch (error: any) {
        console.error("Failed to remove project from collection:", error);
        return { success: false, error: error?.message || "Failed to remove project" };
    }
}

export async function deleteCollectionAction(collectionId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Unauthorized" };
        }

        await db.delete(collections)
            .where(and(eq(collections.id, collectionId), eq(collections.ownerId, user.id)));

        revalidatePath('/hub');
        return { success: true };
    } catch (error: any) {
        console.error("Failed to delete collection:", error);
        return { success: false, error: error?.message || "Failed to delete collection" };
    }
}

export async function getCollectionProjectsAction(collectionId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: "Unauthorized" };
        }
        return await runInFlightDeduped(`collections:projects:${user.id}:${collectionId}`, async () => {
            // Verify ownership
            const [collection] = await db.select().from(collections)
                .where(and(eq(collections.id, collectionId), eq(collections.ownerId, user.id)))
                .limit(1);

            if (!collection) {
                return { success: false, error: "Collection not found or unauthorized" };
            }

            const rows = await db.query.collectionProjects.findMany({
                where: eq(collectionProjects.collectionId, collectionId),
                columns: { projectId: true },
            });
            return { success: true, projectIds: rows.map(r => r.projectId) };
        });
    } catch (error: any) {
        console.error("Failed to fetch collection projects:", error);
        return { success: false, error: error?.message || "Failed to fetch collection projects" };
    }
}
