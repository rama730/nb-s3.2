import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
    const { db } = await import("../src/lib/db");
    const { projectMarkdowns, projects } = await import("../src/lib/db/schema");
    
    const allProjects = await db.select().from(projects);
    console.log("Projects:", allProjects.map(p => ({ id: p.id, slug: p.slug, title: p.title })));
    
    const allMarkdowns = await db.select().from(projectMarkdowns);
    console.log("Markdowns:", allMarkdowns.map(m => ({
        id: m.id,
        projectId: m.projectId,
        slug: m.slug,
        filename: m.filename,
        linkedNodeId: m.linkedNodeId
    })));
}

main().catch(console.error);
