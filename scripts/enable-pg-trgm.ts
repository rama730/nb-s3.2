import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is not set!");
        process.exit(1);
    }
    console.log("Connecting to:", url.replace(/\/\/.*@/, "//***@")); // Mask password

    const sql = postgres(url, { max: 1 });

    console.log("Enabling pg_trgm extension...");
    try {
        await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
        console.log("Success: pg_trgm enabled.");
    } catch (e) {
        console.error("Failed to enable extension:", e);
    }
    await sql.end();
    process.exit(0);
}

main();
