import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("No DATABASE_URL");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`ALTER TABLE "task_node_links" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;`;
    console.log("Successfully added tags column");
  } catch (err) {
    console.error(err);
  } finally {
    await sql.end();
  }
}

run();
