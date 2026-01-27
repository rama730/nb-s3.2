
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "fs";
import path from "path";
import postgres from "postgres";

async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL not found");
        process.exit(1);
    }

    const sql = postgres(connectionString, { max: 1 });

    const files = [
        "scripts/setup-project-files-rls.sql"
    ];

    for (const file of files) {
        const filePath = path.join(process.cwd(), file);
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            continue;
        }
        console.log(`Processing migration: ${file}`);
        const content = fs.readFileSync(filePath, "utf-8");

        // Remove comments
        const cleanContent = content.replace(/--.*$/gm, "");

        // Split by ;
        const statements = cleanContent
            .split(";")
            .map(s => s.trim())
            .filter(s => s.length > 0);

        for (const stmt of statements) {
            try {
                await sql.unsafe(stmt);
                // console.log(`Executed: ${stmt.substring(0, 30)}...`);
            } catch (err: any) {
                console.error(`❌ Statement failed: ${stmt.substring(0, 50)}...`);
                console.error(err.message);
            }
        }
        console.log(`✅ ${file} processed.`);
    }

    await sql.end();
    process.exit(0);
}

runMigrations();
