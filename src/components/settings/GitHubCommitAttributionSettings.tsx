"use client";

import { useState, useEffect } from "react";
import * as sync from "@/app/actions/github-sync";
import { Loader2, CheckCircle2, ShieldCheck, Mail } from "lucide-react";

type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;

export function GitHubCommitAttributionSettings() {
  const [currentIdentity, setCurrentIdentity] = useState<Success<
    Awaited<ReturnType<typeof sync.getCurrentGitHubCommitIdentity>>
  > | null>(null);
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

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4 dark:border-zinc-800 dark:bg-zinc-900/20">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Advanced commit attribution</h4>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            NetworkBase automatically signs Git commits with your privacy-safe GitHub noreply identity.
          </p>
        </div>
        {currentIdentity?.email ? (
          <span className="self-start inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 sm:self-center">
            <CheckCircle2 className="h-3 w-3" />
            Connected
          </span>
        ) : null}
      </div>

      {/* Active Author Identity Card */}
      {currentIdentity && currentIdentity.email ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/80 shadow-sm">
          <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
            <Mail className="h-3.5 w-3.5 text-zinc-500" />
            <span>Active commit author:</span>
          </div>
          <code className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
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
      ) : loadingCurrent ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Loading commit attribution status...</span>
        </div>
      ) : null}
    </div>
  );
}
