"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/hub";
}

export default function LegalAcceptancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOAuthSignup = searchParams.get("context") === "oauth_signup";

  async function continueToNetworkBase() {
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/legal/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepted: true,
          context: isOAuthSignup ? "oauth_signup" : "material_update",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || "Could not record acceptance");
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record acceptance");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <section className="w-full max-w-xl rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-200/40 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none sm:p-9">
        <div className="inline-flex rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300"><ShieldCheck className="h-6 w-6" /></div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">Before you continue</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {isOAuthSignup
            ? "Your sign-in account is connected. Please review and accept NetworkBase’s current legal terms to finish creating your account."
            : "NetworkBase’s legal terms have been introduced or updated. Please review and accept the current versions before continuing."}
        </p>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs text-zinc-500">
          <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-950">Terms<br /><strong>{LEGAL_VERSIONS.terms}</strong></div>
          <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-950">EULA<br /><strong>{LEGAL_VERSIONS.eula}</strong></div>
          <div className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-950">Privacy<br /><strong>{LEGAL_VERSIONS.privacy}</strong></div>
        </div>
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 p-4 text-sm leading-6 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600" />
          <span>I am at least 18 years old, accept the <Link href="/terms" target="_blank" className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Terms of Service</Link> and <Link href="/eula" target="_blank" className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">EULA</Link>, and acknowledge the <Link href="/privacy" target="_blank" className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Privacy Policy</Link>.</span>
        </label>
        {error ? <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <button type="button" disabled={!confirmed || submitting} onClick={() => void continueToNetworkBase()} className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950">
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Agree and continue
        </button>
      </section>
    </main>
  );
}
