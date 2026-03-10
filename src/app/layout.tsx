import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "@/lib/env";
import "./globals.css";
import { getViewerProfileContext } from "@/lib/server/viewer-context";
import { buildThemePrehydrateScript } from "@/lib/theme/appearance";

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
  const { user, profile } = await getViewerProfileContext();
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
              <AuthProvider initialUser={user} initialProfile={profile}>
                <RealtimeProvider>
                  <ChatProvider>{children}</ChatProvider>
                </RealtimeProvider>
              </AuthProvider>
              <Toaster position="bottom-right" />
              <Analytics />
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
