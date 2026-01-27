import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Edge - Professional Social Network",
  description: "Connect, collaborate, and build amazing projects with professionals worldwide",
  keywords: ["professional network", "collaboration", "projects", "social media"],
  authors: [{ name: "Edge Team" }],
  openGraph: {
    title: "Edge - Professional Social Network",
    description: "Connect, collaborate, and build amazing projects with professionals worldwide",
    type: "website",
  },
};

import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/data/profile";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const userProfile = session ? await getUserProfile(session.user.id) : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider initialSession={session} initialProfile={userProfile}>
              <RealtimeProvider>
                <ChatProvider>
                  {children}
                </ChatProvider>
              </RealtimeProvider>
            </AuthProvider>
            <Toaster position="bottom-right" />
            <Analytics />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

