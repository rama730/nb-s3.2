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
 * Best-effort automatic commit attribution. A previously approved email is
 * preserved; first-time users receive GitHub's privacy-safe noreply address.
 */
export async function ensureDefaultGithubContributorIdentity(
  userId: string,
  token: string,
) {
  const account = await syncGithub<GithubAccount>(token, "/user");
  const current = await db.query.githubContributorIdentities.findFirst({
    where: eq(githubContributorIdentities.userId, userId),
  });
  const values = {
    githubId: account.id,
    login: account.login,
    name: account.name || account.login,
    avatarUrl: account.avatar_url,
    email: current?.email || githubNoreplyEmail(account),
    approvedAt: current?.approvedAt || new Date(),
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
