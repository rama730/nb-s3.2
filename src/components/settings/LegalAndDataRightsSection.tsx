"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Database, ExternalLink, FileText, Loader2, Scale, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSIONS } from "@/lib/legal/versions";

type AcceptanceState = {
  current: boolean;
  latest: { acceptedAt: string; termsVersion: string; eulaVersion: string; privacyNoticeVersion: string } | null;
};

const documents = [
  { href: "/privacy", title: "Privacy Policy", description: "What data NetworkBase uses, why, retention periods, sharing, and your rights." },
  { href: "/terms", title: "Terms of Service", description: "The rules that govern accounts, projects, collaboration, content, and the service." },
  { href: "/eula", title: "End User Licence Agreement", description: "The licence and restrictions for the web application, extension, and related software." },
  { href: "/acceptable-use", title: "Acceptable Use Policy", description: "Prohibited content and conduct, enforcement, and how to report abuse." },
  { href: "/cookies", title: "Cookies & Local Storage", description: "Required authentication storage and any optional analytics storage." },
  { href: "/subprocessors", title: "Service Providers", description: "The providers that may process data to operate NetworkBase." },
] as const;

export function LegalAndDataRightsSection() {
  const [state, setState] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/legal/acceptance", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload?.success === false) throw new Error("Acceptance status unavailable");
        return payload.data as AcceptanceState;
      })
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setState(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function acceptCurrentTerms() {
    if (!confirmed) return;
    setAccepting(true);
    try {
      const response = await fetch("/api/v1/legal/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true, context: "settings" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || "Could not save acceptance");
      const refreshed = await fetch("/api/v1/legal/acceptance", { cache: "no-store" }).then((result) => result.json());
      setState(refreshed.data as AcceptanceState);
      toast.success("Your legal acceptance was recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save acceptance");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <>
      <SettingsSectionCard title="Legal documents" description={`Current versions — effective ${LEGAL_EFFECTIVE_DATE}.`}>
        <div className="grid gap-3 md:grid-cols-2">
          {documents.map((document) => (
            <Link key={document.href} href={document.href} target="_blank" className="group rounded-2xl border border-zinc-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{document.title}</span>
                <ExternalLink className="h-4 w-4 text-zinc-400 transition group-hover:text-indigo-500" aria-hidden="true" />
              </div>
              <p className="mt-2 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{document.description}</p>
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          <Link className="text-indigo-600 hover:underline dark:text-indigo-300" href="/copyright" target="_blank">Copyright & IP complaints</Link>
          <Link className="text-indigo-600 hover:underline dark:text-indigo-300" href="/privacy#changes" target="_blank">Privacy contact</Link>
          <Link className="text-indigo-600 hover:underline dark:text-indigo-300" href="/grievances" target="_blank">Grievance contact</Link>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="Terms acceptance" description="NetworkBase keeps a limited record of affirmative acceptance so both you and the service can identify the terms that applied.">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking your status…</div>
        ) : state?.current ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Current Terms and EULA accepted</div>
              <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/80">Recorded {state.latest?.acceptedAt ? new Date(state.latest.acceptedAt).toLocaleString() : "for this account"}. Privacy Policy acknowledgement is recorded as a notice, not consent to unnecessary processing.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-sm leading-6 text-amber-950 dark:text-amber-100">We do not have a record that this account accepted the current Terms of Service ({LEGAL_VERSIONS.terms}) and EULA ({LEGAL_VERSIONS.eula}).</p>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600" />
              <span>I am at least 18 years old, accept the <Link href="/terms" target="_blank" className="font-semibold text-indigo-600 hover:underline">Terms of Service</Link> and <Link href="/eula" target="_blank" className="font-semibold text-indigo-600 hover:underline">EULA</Link>, and acknowledge the <Link href="/privacy" target="_blank" className="font-semibold text-indigo-600 hover:underline">Privacy Policy</Link>.</span>
            </label>
            <button type="button" disabled={!confirmed || accepting} onClick={() => void acceptCurrentTerms()} className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950">
              {accepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scale className="mr-2 h-4 w-4" />} Accept current terms
            </button>
          </div>
        )}
      </SettingsSectionCard>

      <SettingsSectionCard title="Your data rights" description="Practical controls for access, portability, correction, deletion, and third-party connections.">
        <div className="grid gap-3 md:grid-cols-3">
          <Link href="/settings?tab=account" className="rounded-2xl border border-zinc-200 p-4 hover:border-indigo-300 dark:border-zinc-800 dark:hover:border-indigo-700"><Database className="h-5 w-5 text-indigo-500" /><div className="mt-3 text-sm font-semibold">Export or delete</div><p className="mt-1 text-xs leading-5 text-zinc-500">Download account data or begin the deletion process.</p></Link>
          <Link href="/settings?tab=integrations" className="rounded-2xl border border-zinc-200 p-4 hover:border-indigo-300 dark:border-zinc-800 dark:hover:border-indigo-700"><FileText className="h-5 w-5 text-indigo-500" /><div className="mt-3 text-sm font-semibold">Connected services</div><p className="mt-1 text-xs leading-5 text-zinc-500">Review and disconnect GitHub or other integrations.</p></Link>
          <Link href="/settings?tab=security" className="rounded-2xl border border-zinc-200 p-4 hover:border-indigo-300 dark:border-zinc-800 dark:hover:border-indigo-700"><ShieldCheck className="h-5 w-5 text-indigo-500" /><div className="mt-3 text-sm font-semibold">Account security</div><p className="mt-1 text-xs leading-5 text-zinc-500">Review sessions and security activity.</p></Link>
        </div>
      </SettingsSectionCard>
    </>
  );
}
