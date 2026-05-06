import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { QueryProvider } from "@/components/providers/query-provider";
import { SecurityRuntimeProvider } from "@/components/providers/SecurityRuntimeProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
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
  applicationName: "Edge",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Edge",
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const messages = await getMessages();
  const nonce = headerStore.get("x-nonce") || undefined;

  return (
    <html lang="en" data-scroll-behavior="smooth" data-csp-nonce={nonce} suppressHydrationWarning>
      <head>
        <meta content="#ffffff" data-app-theme-color="true" name="theme-color" />
        <Script id="theme-prehydrate" nonce={nonce} strategy="beforeInteractive">
          {THEME_PREHYDRATE_SCRIPT}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <SecurityRuntimeProvider nonce={nonce ?? null}>
          <NextIntlClientProvider messages={messages}>
            <ThemeProvider nonce={nonce ?? undefined}>
              <QueryProvider>
                <RoutePerformanceObserver />
                {children}
                <Toaster position="bottom-right" />
                {SHOULD_RENDER_VERCEL_ANALYTICS ? <Analytics /> : null}
              </QueryProvider>
            </ThemeProvider>
          </NextIntlClientProvider>
        </SecurityRuntimeProvider>
      </body>
    </html>
  );
}
