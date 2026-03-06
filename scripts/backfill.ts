import { db } from "../src/lib/db";
import { projectNodes, projects, tags, projectTags, skills, projectSkills, profiles, profileSkills, profileInterests, interests } from "../src/lib/db/schema";
import { eq, isNull } from "drizzle-orm";

async function backfillTags() {
    console.log("Backfilling project tags and skills...");
    const allProjects = await db.select().from(projects);

    let tagCount = 0;
    let skillCount = 0;

    for (const p of allProjects) {
        // Handle Project Tags
        if (p.tags && Array.isArray(p.tags)) {
            for (const t of p.tags) {
                const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!slug) continue;

                let [tag] = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1);
                if (!tag) {
                    try { [tag] = await db.insert(tags).values({ name: t, slug }).returning(); } catch { }
                }
                if (tag) {
                    await db.insert(projectTags).values({ projectId: p.id, tagId: tag.id }).onConflictDoNothing();
                    tagCount++;
                }
            }
        }

        // Handle Project Skills
        if (p.skills && Array.isArray(p.skills)) {
            for (const s of p.skills) {
                const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!slug) continue;

                let [skill] = await db.select().from(skills).where(eq(skills.slug, slug)).limit(1);
                if (!skill) {
                    try { [skill] = await db.insert(skills).values({ name: s, slug }).returning(); } catch { }
                }
                if (skill) {
                    await db.insert(projectSkills).values({ projectId: p.id, skillId: skill.id }).onConflictDoNothing();
                    skillCount++;
                }
            }
        }
    }
    console.log(`Finished inserting ${tagCount} project tags and ${skillCount} project skills.`);
}

async function backfillProfileJSONB() {
    console.log("Backfilling profile skills and interests...");
    const allProfiles = await db.select().from(profiles);
    let sCount = 0;
    let iCount = 0;

    for (const p of allProfiles) {
        if (p.skills && Array.isArray(p.skills)) {
            for (const s of p.skills) {
                const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!slug) continue;
                let [skill] = await db.select().from(skills).where(eq(skills.slug, slug)).limit(1);
                if (!skill) {
                    try { [skill] = await db.insert(skills).values({ name: s, slug }).returning(); } catch { }
                }
                if (skill) {
                    await db.insert(profileSkills).values({ profileId: p.id, skillId: skill.id }).onConflictDoNothing();
                    sCount++;
                }
            }
        }

        if (p.interests && Array.isArray(p.interests)) {
            for (const interest of p.interests) {
                const slug = interest.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!slug) continue;
                let [intr] = await db.select().from(interests).where(eq(interests.slug, slug)).limit(1);
                if (!intr) {
                    try { [intr] = await db.insert(interests).values({ name: interest, slug }).returning(); } catch { }
                }
                if (intr) {
                    await db.insert(profileInterests).values({ profileId: p.id, interestId: intr.id }).onConflictDoNothing();
                    iCount++;
                }
            }
        }
    }
    console.log(`Finished inserting ${sCount} profile skills and ${iCount} profile interests.`);
}

async function backfillPaths() {
    console.log("Backfilling Project Nodes materialized paths...");

    // Nodes missing a path OR empty string path (if we created it empty accidentally during pushing migration)
    const missingNodes = await db.select().from(projectNodes).where(isNull(projectNodes.path));
    // Wait, Drizzle default for missing texts if NOT NULL might be empty string. We should get ALL nodes, and build a map.
    const allNodesList = await db.select().from(projectNodes);

    // We'll build the tree in memory mapping node_id to path locally.
    const nodeMap = new Map(allNodesList.map(n => [n.id, n]));
    const pathCache = new Map<string, string>();
    let updateCount = 0;

    function buildPath(nodeId: string): string {
        if (pathCache.has(nodeId)) return pathCache.get(nodeId)!;
        const node = nodeMap.get(nodeId);
        if (!node) return `/${nodeId}`; // Failsafe

        // Root system node doesn't have parentId but its path should be its name
        if (!node.parentId) {
            const path = `/${node.name}`;
            pathCache.set(node.id, path);
            return path;
        }

        const parentPath = buildPath(node.parentId);
        const path = `${parentPath}/${node.name}`;
        pathCache.set(node.id, path);
        return path;
    }

    const updates = [];
    for (const node of allNodesList) {
        const correctPath = buildPath(node.id);
        if (node.path !== correctPath) {
            updates.push({ id: node.id, path: correctPath });
        }
    }

    console.log(`Requires ${updates.length} updates. Processing in batches of 50...`);
    const BATCH_SIZE = 50;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(u =>
            db.update(projectNodes).set({ path: u.path }).where(eq(projectNodes.id, u.id))
        ));
        updateCount += batch.length;
        if (i % 500 === 0) console.log(`Processed ${updateCount} / ${updates.length}`);
    }

    console.log(`Finished updating ${updateCount} materialized paths.`);
}

async function main() {
    try {
        await backfillTags();
        await backfillProfileJSONB();
        await backfillPaths();
        console.log("Migration and data backfill fully completed.");
    } catch (e) {
        console.error("Migration failed:", e);
    }
    process.exit(0);
}

main();
