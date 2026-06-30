import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

function normalizeMarkdown(md: string): string {
    return md
        .replace(/\r\n/g, "\n")
        .replace(/\s+\n/g, "\n")
        .trim();
}

function findDuplicationPoint(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed.length < 100) return null;

    const lines = trimmed.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    // Try to find the first heading or the first non-empty line as an anchor
    const anchor = lines.find(line => line.startsWith('#')) || lines[0];
    if (!anchor || anchor.length < 5) return null;

    // Find all occurrences of anchor in the original text (except the first one at index 0 or near start)
    const indices: number[] = [];
    let idx = trimmed.indexOf(anchor, anchor.length);
    while (idx !== -1) {
        indices.push(idx);
        idx = trimmed.indexOf(anchor, idx + anchor.length);
    }

    for (const splitIndex of indices) {
        const part1 = trimmed.substring(0, splitIndex).trim();
        const part2 = trimmed.substring(splitIndex).trim();

        // Check if part2 starts with part1 (exact match)
        if (part2.startsWith(part1)) {
            return splitIndex;
        }

        // Or if part1 starts with part2 (when the last repetition was truncated/incomplete)
        if (part1.startsWith(part2) && part2.length > part1.length * 0.5) {
            return splitIndex;
        }

        // Or we can check if the normalized versions match
        const norm1 = part1.replace(/\s+/g, "");
        const norm2 = part2.replace(/\s+/g, "");
        if (norm2.startsWith(norm1) || norm1.startsWith(norm2)) {
            return splitIndex;
        }
    }

    return null;
}

async function main() {
    console.log("Loading modules...");
    const { db } = await import("../src/lib/db");
    const { projectReadmes } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const fs = await import("fs");
    const path = await import("path");

    console.log("Fetching all project readmes...");
    const readmes = await db.select().from(projectReadmes);
    console.log(`Found ${readmes.length} total readmes.`);

    let fixedCount = 0;

    for (const readme of readmes) {
        if (!readme.draftContent) continue;

        const duplicationPoint = findDuplicationPoint(readme.draftContent);
        if (duplicationPoint !== null) {
            const originalLength = readme.draftContent.length;
            const cleanedContent = readme.draftContent.substring(0, duplicationPoint).trimEnd();
            
            console.log(`[DEDUPE] Found duplicate for project ID: ${readme.projectId}`);
            console.log(`         Length reduced from ${originalLength} to ${cleanedContent.length} chars.`);
            
            await db.update(projectReadmes)
                .set({ 
                    draftContent: cleanedContent,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(projectReadmes.id, readme.id));
            
            fixedCount++;
        }
    }

    console.log(`\nPostgres Cleanup completed. Fixed ${fixedCount} readmes.`);

    // Reset local Yjs SQLite cache if it exists
    // @ts-ignore - __dirname is not defined in ESM but is injected by tsx
    const dir = typeof __dirname !== 'undefined' ? __dirname : undefined;
    const sqlitePaths = [
        path.join(process.cwd(), "yjs-local.sqlite"),
    ];
    if (dir) {
        sqlitePaths.push(path.resolve(dir, "../yjs-local.sqlite"));
    }
    for (const sqlitePath of sqlitePaths) {
        if (fs.existsSync(sqlitePath)) {
            console.log(`\nLocal Yjs cache (${sqlitePath}) detected.`);
            try {
                fs.unlinkSync(sqlitePath);
                console.log(`Successfully deleted ${sqlitePath} to reset collaborative editor state.`);
            } catch (err) {
                console.error(`Failed to delete ${sqlitePath} automatically:`, err);
                console.log(`Please delete ${sqlitePath} manually to reset editor collaboration caches.`);
            }
        }
    }

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
