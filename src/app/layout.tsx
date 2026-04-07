import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { QueryProvider } from "@/components/providers/query-provider";
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

export const metadata: Metadata = {
  metadataBase: APP_METADATA_BASE,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = await getMessages();

  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <meta content="#ffffff" data-app-theme-color="true" name="theme-color" />
        <Script id="theme-prehydrate" strategy="beforeInteractive">
          {THEME_PREHYDRATE_SCRIPT}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <QueryProvider>
              <RoutePerformanceObserver />
              {children}
              <Toaster position="bottom-right" />
              {process.env.NODE_ENV === "production" ? <Analytics /> : null}
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
