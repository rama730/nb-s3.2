const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const sql = `
CREATE OR REPLACE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_target_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants viewer
      JOIN public.conversation_participants target
        ON target.conversation_id = viewer.conversation_id
      WHERE viewer.user_id = (SELECT auth.uid())
        AND target.user_id = p_target_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members viewer
      JOIN public.project_members target
        ON target.project_id = viewer.project_id
      WHERE viewer.user_id = (SELECT auth.uid())
        AND target.user_id = p_target_user_id
    );
$$;
  `;
  await client.query(sql);
  console.log('Successfully updated RLS function.');
  await client.end();
}
main().catch(console.error);
