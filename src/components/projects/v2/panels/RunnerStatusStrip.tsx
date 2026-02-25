"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getRunnerPref } from "@/lib/runner/prefs";
import { getExecutionBackendStatus } from "@/app/actions/execute";

let backendStatusCache: { configured: boolean } | null = null;

export function RunnerStatusStrip() {
  const [backendConfigured, setBackendConfigured] = useState<boolean | null>(
    () => backendStatusCache?.configured ?? null
  );
  const typescriptEnabled = getRunnerPref("runner.typescript.enabled") === "true";

  useEffect(() => {
    if (backendStatusCache !== null) {
      setBackendConfigured(backendStatusCache.configured);
      return;
    }
    getExecutionBackendStatus().then((s) => {
      backendStatusCache = s;
      setBackendConfigured(s.configured);
    });
  }, []);

  const languagesHref = "/settings/languages";

  return (
    <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
      <span>Python</span>
      <span className="text-green-600 dark:text-green-400">OK</span>
      <span className="text-zinc-300 dark:text-zinc-600">|</span>
      <span>JS</span>
      <span className="text-green-600 dark:text-green-400">OK</span>
      <span className="text-zinc-300 dark:text-zinc-600">|</span>
      <span>TS</span>
      {typescriptEnabled ? (
        <span className="text-green-600 dark:text-green-400">OK</span>
      ) : (
        <Link
          href={`${languagesHref}#typescript`}
          className="text-amber-600 dark:text-amber-400 hover:underline"
        >
          Configure
        </Link>
      )}
      <span className="text-zinc-300 dark:text-zinc-600">|</span>
      <span>Java/C++</span>
      {backendConfigured === null ? (
        <span className="animate-pulse">…</span>
      ) : backendConfigured ? (
        <span className="text-green-600 dark:text-green-400">OK</span>
      ) : (
        <Link
          href={`${languagesHref}#backend`}
          className="text-amber-600 dark:text-amber-400 hover:underline"
        >
          Configure
        </Link>
      )}
    </div>
  );
}
