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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const THEME_PREHYDRATE_SCRIPT = buildThemePrehydrateScript();

export const metadata: Metadata = {
  title: "Edge - Professional Social Network",
  description: "Connect, collaborate, and build amazing projects with professionals worldwide",
  keywords: ["professional network", "collaboration", "projects", "social media"],
  authors: [{ name: "Edge Team" }],
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  openGraph: {
    title: "Edge - Professional Social Network",
    description: "Connect, collaborate, and build amazing projects with professionals worldwide",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = await getMessages();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
              <Analytics />
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
