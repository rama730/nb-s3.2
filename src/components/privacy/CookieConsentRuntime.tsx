"use client";

import { Analytics } from "@vercel/analytics/react";
import { BarChart3, ChevronLeft, LockKeyhole, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  CookieConsentDecision,
  OPEN_COOKIE_SETTINGS_EVENT,
  createCookieConsentDecision,
  readCookieConsentDecision,
  writeCookieConsentDecision,
} from "@/lib/privacy/cookie-consent";

const AUTH_ENTRY_PATHS = new Set(["/login", "/signup"]);

export function CookieConsentRuntime({ analyticsAvailable }: { analyticsAvailable: boolean }) {
  const pathname = usePathname();
  const [decision, setDecision] = useState<CookieConsentDecision | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [analyticsChoice, setAnalyticsChoice] = useState(false);

  const openSettings = useCallback(() => {
    const current = readCookieConsentDecision();
    setDecision(current);
    setAnalyticsChoice(current?.analytics ?? false);
    setIsCustomizing(Boolean(current));
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const current = readCookieConsentDecision();
    setDecision(current);
    setAnalyticsChoice(current?.analytics ?? false);
    setIsReady(true);

    if (!current && AUTH_ENTRY_PATHS.has(pathname)) {
      setIsOpen(true);
    }
  }, [pathname]);

  useEffect(() => {
    const handleOpen = () => openSettings();
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<CookieConsentDecision>).detail;
      setDecision(next ?? readCookieConsentDecision());
    };

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, handleOpen);
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, handleOpen);
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleChange);
    };
  }, [openSettings]);

  const saveChoice = useCallback((analytics: boolean) => {
    const next = createCookieConsentDecision(analytics);
    writeCookieConsentDecision(next);
    setDecision(next);
    setAnalyticsChoice(analytics);
    setIsCustomizing(false);
    setIsOpen(false);
  }, []);

  return (
    <>
      {analyticsAvailable && decision?.analytics ? <Analytics /> : null}

      {isReady && isOpen ? (
        <section
          aria-describedby="cookie-consent-description"
          aria-label="Cookie settings"
          aria-live="polite"
          className="fixed inset-x-4 bottom-4 z-[70] w-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-[0_24px_70px_rgba(15,23,42,0.22)] sm:inset-x-auto sm:right-5 sm:w-[26rem] dark:shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
          role="dialog"
        >
          {decision ? (
            <button
              type="button"
              aria-label="Close cookie settings"
              className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}

          {isCustomizing ? (
            <CookiePreferenceEditor
              analyticsChoice={analyticsChoice}
              onAnalyticsChange={setAnalyticsChoice}
              onBack={() => setIsCustomizing(false)}
              onSave={() => saveChoice(analyticsChoice)}
            />
          ) : (
            <CookieConsentSummary
              onAcceptAll={() => saveChoice(true)}
              onCustomize={() => setIsCustomizing(true)}
              onRejectOptional={() => saveChoice(false)}
            />
          )}
        </section>
      ) : null}
    </>
  );
}

function CookieConsentSummary({
  onAcceptAll,
  onCustomize,
  onRejectOptional,
}: {
  onAcceptAll: () => void;
  onCustomize: () => void;
  onRejectOptional: () => void;
}) {
  return (
    <>
      <h2 className="pr-8 text-lg font-semibold tracking-tight">Cookie settings</h2>
      <p id="cookie-consent-description" className="mt-3 text-sm leading-6 text-muted-foreground">
        We use essential cookies to secure your account and provide NetworkBase. With your permission, we also use analytics to understand and improve the service. Read our{" "}
        <Link href="/cookies" className="font-medium text-foreground underline underline-offset-4">
          Cookie and Storage Notice
        </Link>
        .
      </p>

      <div className="mt-5 grid gap-2.5">
        <Button type="button" variant="secondary" className="h-11 w-full" onClick={onCustomize}>
          Customize cookie settings
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" className="h-11 w-full" onClick={onRejectOptional}>
            Reject optional
          </Button>
          <Button type="button" className="h-11 w-full" onClick={onAcceptAll}>
            Accept all
          </Button>
        </div>
      </div>
    </>
  );
}

function CookiePreferenceEditor({
  analyticsChoice,
  onAnalyticsChange,
  onBack,
  onSave,
}: {
  analyticsChoice: boolean;
  onAnalyticsChange: (value: boolean) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>
      <h2 className="pr-8 text-lg font-semibold tracking-tight">Choose what NetworkBase can use</h2>
      <p id="cookie-consent-description" className="mt-2 text-sm leading-6 text-muted-foreground">
        Essential storage is always active. Analytics remains off unless you allow it.
      </p>

      <div className="mt-5 space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-border p-3.5">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Essential</h3>
              <span className="text-xs font-medium text-muted-foreground">Always active</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Required for authentication, security, legal choices, and requested preferences.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-border p-3.5">
          <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Analytics</h3>
              <button
                type="button"
                role="switch"
                aria-checked={analyticsChoice}
                aria-label="Allow analytics cookies"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  analyticsChoice ? "border-primary bg-primary" : "border-border bg-muted"
                }`}
                onClick={() => onAnalyticsChange(!analyticsChoice)}
              >
                <span
                  className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-background shadow-sm transition-transform ${
                    analyticsChoice ? "translate-x-[1.25rem]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Helps us measure usage and reliability so we can improve the product.
            </p>
          </div>
        </div>
      </div>

      <Button type="button" className="mt-5 h-11 w-full" onClick={onSave}>
        Save choices
      </Button>
    </>
  );
}
