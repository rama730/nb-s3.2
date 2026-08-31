import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const hostname = new URL(databaseUrl).hostname;
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(hostname) ? false : "require",
});

try {
  const [role] = await sql<{
    roleName: string;
    bypassRls: boolean;
    superuser: boolean;
  }[]>`
    SELECT rolname AS "roleName", rolbypassrls AS "bypassRls", rolsuper AS superuser
    FROM pg_roles
    WHERE rolname = current_user
  `;

  if (!role || role.bypassRls || role.superuser) {
    throw new Error(
      `DATABASE_URL must use a least-privilege non-BYPASSRLS runtime role; current=${role?.roleName ?? "unknown"}`,
    );
  }
  console.log(`[runtime-database-role] ok (${role.roleName})`);
} finally {
  await sql.end();
}
