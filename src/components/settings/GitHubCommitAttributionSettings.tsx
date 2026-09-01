"use client";

import { useState } from "react";
import * as sync from "@/app/actions/github-sync";

const button =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 focus-visible:outline-blue-500";
const input =
  "min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;

/** Optional override; OAuth assigns privacy-safe GitHub noreply attribution automatically. */
export function GitHubCommitAttributionSettings() {
  const [options, setOptions] = useState<Success<
    Awaited<ReturnType<typeof sync.getGitHubCommitIdentityOptions>>
  > | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const result = await sync.getGitHubCommitIdentityOptions();
      if (!result.success) throw new Error(result.error);
      setOptions(result.data);
      setEmail(result.data.emails.at(-1) || "");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      const result = await sync.approveGitHubCommitIdentity(email);
      if (!result.success) throw new Error(result.error);
      setMessage(`GitHub attribution updated for @${result.data.login}.`);
      setOptions(null);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <summary className="cursor-pointer font-medium">
        Advanced commit attribution
      </summary>
      <p className="my-3 text-sm text-zinc-500">
        Edge automatically uses your privacy-safe GitHub noreply identity. Only
        choose another verified GitHub email if you want to publish it in
        commits.
      </p>
      <button
        type="button"
        className={button}
        disabled={busy}
        onClick={() => void load()}
      >
        Choose another verified email
      </button>
      {options && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            Commit email for @{options.account.login}
            <select
              className={input}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            >
              {options.emails.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={button}
            disabled={busy || !email}
            onClick={() => void approve()}
          >
            Save attribution
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </details>
  );
}
