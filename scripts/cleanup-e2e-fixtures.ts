import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_ID = process.env.E2E_RUN_ID || 'local';
const TARGET_EMAIL = process.env.E2E_USER_EMAIL || 'codex.e2e.smoke@example.com';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: 'require',
});

const ONBOARDING_FIXTURE_EMAILS = [
  process.env.E2E_ONBOARDING_HAPPY_EMAIL || 'codex.onboarding.happy@example.com',
  process.env.E2E_ONBOARDING_RESERVED_EMAIL || 'codex.onboarding.reserved@example.com',
  process.env.E2E_ONBOARDING_COLLISION_EMAIL || 'codex.onboarding.collision@example.com',
  process.env.E2E_ONBOARDING_RATELIMIT_EMAIL || 'codex.onboarding.ratelimit@example.com',
  process.env.E2E_ONBOARDING_IDEMPOTENT_EMAIL || 'codex.onboarding.idempotent@example.com',
];

async function cleanup() {
  await sql.begin(async (tx: any) => {
    const runPattern = `%${RUN_ID}%`;

    await tx`
      delete from messages
      where content ilike ${runPattern}
        and conversation_id in (
          select cp.conversation_id
          from conversation_participants cp
          join profiles p on p.id = cp.user_id
          where p.email = ${TARGET_EMAIL}
        )
    `;

    await tx`
      delete from project_nodes
      where name ilike ${runPattern}
         or metadata->>'fixture' ilike ${`%${RUN_ID}%`}
    `;

    const onboardingUsers = await tx<{ id: string }[]>`
      select id from profiles where email = any(${onboardingFixtureEmails(ONBOARDING_FIXTURE_EMAILS)})
    `;

    const onboardingIds = onboardingUsers.map((u: { id: string }) => u.id);
    if (onboardingIds.length > 0) {
      await tx`delete from onboarding_events where user_id = any(${onboardingIds})`;
      await tx`delete from onboarding_submissions where user_id = any(${onboardingIds})`;
      await tx`delete from onboarding_drafts where user_id = any(${onboardingIds})`;
    }
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        runId: RUN_ID,
      },
      null,
      2,
    ),
  );
}

function onboardingFixtureEmails(emails: string[]) {
  return emails.filter(Boolean);
}

cleanup()
  .catch((error) => {
    console.error('Failed to cleanup E2E fixtures:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
