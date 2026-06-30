import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    try {
        console.log("Applying column addition...");
        const { db } = await import('../src/lib/db');
        const { sql } = await import('drizzle-orm');
        
        await db.execute(sql`
            ALTER TABLE "project_readmes" 
            ADD COLUMN IF NOT EXISTS "linked_node_id" uuid REFERENCES "project_nodes"("id") ON DELETE SET NULL;
        `);
        console.log("Column linked_node_id added successfully!");
        process.exit(0);
    } catch (e) {
        console.error("Migration failed:", e);
        process.exit(1);
    }
}
main();
