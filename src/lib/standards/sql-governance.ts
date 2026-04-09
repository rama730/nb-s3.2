import { z } from "zod";

export const SQL_CHANGE_KINDS = [
  "query_only",
  "remigration",
  "break_glass",
] as const;

const SqlGovernanceExceptionSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
  approvedBy: z.string().min(1),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const SqlGovernanceManifestSchema = z.object({
  policyVersion: z.literal(1),
  defaultChangeKind: z.enum(SQL_CHANGE_KINDS),
  migrationDirectory: z.string().min(1),
  existingMigrationFiles: z.array(z.string().min(1)).min(1),
  allowedUtilitySqlFiles: z.array(z.string().min(1)).default([]),
  breakGlassExceptions: z.array(SqlGovernanceExceptionSchema).default([]),
});

export type SqlChangeKind = (typeof SQL_CHANGE_KINDS)[number];
export type SqlGovernanceException = z.infer<typeof SqlGovernanceExceptionSchema>;
export type SqlGovernanceManifest = z.infer<typeof SqlGovernanceManifestSchema>;

export function parseSqlGovernanceManifest(value: unknown): SqlGovernanceManifest {
  return SqlGovernanceManifestSchema.parse(value);
}
