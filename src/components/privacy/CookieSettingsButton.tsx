"use client";

import { openCookieSettings } from "@/lib/privacy/cookie-consent";
import { cn } from "@/lib/utils";

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={cn("underline-offset-4 hover:text-foreground hover:underline", className)}
      onClick={openCookieSettings}
    >
      Cookie settings
    </button>
  );
}
