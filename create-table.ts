import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db } from './src/lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    console.log("Creating task_pushes table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS public.task_pushes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
          project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
          message text,
          files_count integer DEFAULT 0 NOT NULL,
          pushed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
          pushed_at timestamp with time zone DEFAULT now() NOT NULL,
          files_json jsonb DEFAULT '[]'::jsonb NOT NULL
      );
    `);
    console.log("Creating indexes...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS task_pushes_task_idx ON public.task_pushes (task_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS task_pushes_task_pushed_at_idx ON public.task_pushes (task_id, pushed_at DESC);
    `);
    console.log("Table and indexes created successfully!");
    process.exit(0);
  } catch (e) {
    console.error("Failed to create table:", e);
    process.exit(1);
  }
}
main();
