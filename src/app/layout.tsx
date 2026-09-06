import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { QueryProvider } from "@/components/providers/query-provider";
import { SecurityRuntimeProvider } from "@/components/providers/SecurityRuntimeProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { CookieConsentRuntime } from "@/components/privacy/CookieConsentRuntime";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "@/lib/env";
import "./globals.css";
import { buildThemePrehydrateScript } from "@/lib/theme/appearance";
import { RoutePerformanceObserver } from "@/components/observability/RoutePerformanceObserver";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const THEME_PREHYDRATE_SCRIPT = buildThemePrehydrateScript();
const APP_METADATA_BASE = new URL(
  resolveAuthBaseUrl({ requireConfiguredBaseInProduction: false }),
);
const SHOULD_RENDER_VERCEL_ANALYTICS =
  process.env.NODE_ENV === "production"
  && ["1", "true", "yes", "on"].includes((process.env.VERCEL || "").trim().toLowerCase());

export const metadata: Metadata = {
  metadataBase: APP_METADATA_BASE,
  applicationName: "NetworkBase",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: import("next").Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

import { TooltipProvider } from "@/components/ui/tooltip";

async function I18nAndThemeProviders({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <ThemeProvider nonce={nonce}>
        <QueryProvider>
          <TooltipProvider>
            <RoutePerformanceObserver />
            {children}
            <Toaster position="top-right" />
            <CookieConsentRuntime analyticsAvailable={SHOULD_RENDER_VERCEL_ANALYTICS} />
          </TooltipProvider>
        </QueryProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

import { Suspense } from 'react';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const nonce = headerStore.get("x-nonce") || undefined;
  
  return (
    <html lang="en" data-scroll-behavior="smooth" data-csp-nonce={nonce} suppressHydrationWarning>
      <head>
        <meta content="#ffffff" data-app-theme-color="true" name="theme-color" />
        <script
          id="theme-prehydrate"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_PREHYDRATE_SCRIPT }}
          suppressHydrationWarning
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <SecurityRuntimeProvider nonce={nonce ?? null}>
          <Suspense fallback={<div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950" />}>
            <I18nAndThemeProviders nonce={nonce ?? undefined}>
              {children}
            </I18nAndThemeProviders>
          </Suspense>
        </SecurityRuntimeProvider>
      </body>
    </html>
  );
}
