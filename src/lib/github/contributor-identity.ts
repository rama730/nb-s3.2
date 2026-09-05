import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubContributorIdentities } from "@/lib/db/schema";
import { syncGithub } from "@/lib/github/sync-api";

type GithubAccount = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
};

export function githubNoreplyEmail(
  account: Pick<GithubAccount, "id" | "login">,
) {
  return `${account.id}+${account.login}@users.noreply.github.com`;
}

/**
 * Best-effort automatic commit attribution. An approved email is preserved
 * only while it still belongs to the same GitHub account. Replacing a deleted
 * account resets future commits to the new account's privacy-safe identity;
 * historical sync snapshots remain unchanged.
 */
export async function ensureDefaultGithubContributorIdentity(
  userId: string,
  token: string,
) {
  const account = await syncGithub<GithubAccount>(token, "/user");
  const current = await db.query.githubContributorIdentities.findFirst({
    where: eq(githubContributorIdentities.userId, userId),
  });
  const sameGithubAccount = current?.githubId === account.id;
  const values = {
    githubId: account.id,
    login: account.login,
    name: account.name || account.login,
    avatarUrl: account.avatar_url,
    email: sameGithubAccount && current?.email
      ? current.email
      : githubNoreplyEmail(account),
    approvedAt: sameGithubAccount && current?.approvedAt
      ? current.approvedAt
      : new Date(),
  };
  await db
    .insert(githubContributorIdentities)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: githubContributorIdentities.userId,
      set: values,
    });
  return values;
}
