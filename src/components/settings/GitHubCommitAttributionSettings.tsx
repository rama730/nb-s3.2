"use client";

import { useState, useEffect } from "react";
import * as sync from "@/app/actions/github-sync";
import { Loader2, CheckCircle2, ShieldCheck, Mail } from "lucide-react";

const button =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 focus-visible:outline-blue-500 transition-colors";
const saveButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors";
const selectStyle =
  "min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-500";

type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;

export function GitHubCommitAttributionSettings() {
  const [currentIdentity, setCurrentIdentity] = useState<Success<
    Awaited<ReturnType<typeof sync.getCurrentGitHubCommitIdentity>>
  > | null>(null);
  const [options, setOptions] = useState<Success<
    Awaited<ReturnType<typeof sync.getGitHubCommitIdentityOptions>>
  > | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSuccessMessage, setIsSuccessMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingCurrent(true);
    sync.getCurrentGitHubCommitIdentity()
      .then((res) => {
        if (active && res.success && res.data) {
          setCurrentIdentity(res.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingCurrent(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const result = await sync.getGitHubCommitIdentityOptions();
      if (!result.success) throw new Error(result.error);
      setOptions(result.data);
      setEmail(currentIdentity?.email || result.data.emails[0] || "");
    } catch (error) {
      setIsSuccessMessage(false);
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setMessage("");
    try {
      const result = await sync.approveGitHubCommitIdentity(email);
      if (!result.success) throw new Error(result.error);
      setIsSuccessMessage(true);
      setMessage(`Commit author email updated for @${result.data.login}.`);
      if (currentIdentity) {
        setCurrentIdentity({
          ...currentIdentity,
          email,
          isNoreply: email.includes("noreply.github.com"),
          configured: true,
        });
      }
      setOptions(null);
    } catch (error) {
      setIsSuccessMessage(false);
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 group">
      <summary className="cursor-pointer font-medium text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
        <span>Advanced commit attribution</span>
      </summary>

      <p className="my-3 text-sm text-zinc-500 dark:text-zinc-400">
        NetworkBase automatically signs Git commits with your privacy-safe GitHub noreply identity. You can also choose any verified email from your GitHub account to publish on commits.
      </p>

      {/* Active Author Identity Card */}
      {currentIdentity && currentIdentity.email ? (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3.5 py-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
            <Mail className="h-3.5 w-3.5 text-zinc-500" />
            <span>Active commit author:</span>
          </div>
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
            {currentIdentity.email}
          </code>
          {currentIdentity.isNoreply ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
              <ShieldCheck className="h-3 w-3" />
              Privacy-safe noreply
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
              <CheckCircle2 className="h-3 w-3" />
              Verified email
            </span>
          )}
        </div>
      ) : null}

      {!options ? (
        <button
          type="button"
          className={button}
          disabled={busy || loadingCurrent}
          onClick={() => void load()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Choose another verified email
        </button>
      ) : null}

      {options && (
        <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Select verified commit email for @{options.account.login}:
            <select
              className={`${selectStyle} mt-1.5`}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            >
              {options.emails.map((value) => (
                <option key={value} value={value}>
                  {value} {value.includes("noreply.github.com") ? "(Privacy-safe noreply)" : "(Verified email)"}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={saveButton}
              disabled={busy || !email}
              onClick={() => void approve()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save attribution
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                setOptions(null);
                setMessage("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`mt-2 text-xs font-medium ${
            isSuccessMessage
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {message}
        </p>
      )}
    </details>
  );
}
