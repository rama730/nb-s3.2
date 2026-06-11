import type { NextConfig } from "next";
import path from "path";
import nextBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withBundleAnalyzer = nextBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const configuredPresenceWsUrl =
  process.env.NEXT_PUBLIC_PRESENCE_WS_URL || process.env.PRESENCE_WS_URL || "";
const allowLocalPresenceConnect =
  process.env.NODE_ENV !== "production" ||
  /(^|:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/.test(configuredPresenceWsUrl);
const localPresenceConnectSources = allowLocalPresenceConnect
  ? ["ws://localhost:*", "ws://127.0.0.1:*", "ws://0.0.0.0:*"]
  : [];
const e2eAuthRouteImplRelativePath =
  process.env.NODE_ENV === "production"
    ? "./src/app/api/e2e/auth/route.disabled.ts"
    : "./src/app/api/e2e/auth/route.dev.ts";
const e2eAuthRouteImplAbsolutePath =
  process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "src/app/api/e2e/auth/route.disabled.ts")
    : path.resolve(__dirname, "src/app/api/e2e/auth/route.dev.ts");

const nextConfig: NextConfig = {
  // Security headers for all routes
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' https://fonts.gstatic.com",
              [
                "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
                ...localPresenceConnectSources,
              ].join(" "),
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },

  // Turbopack configuration - use absolute path to silence warning
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      "@/app/api/e2e/auth/route-impl": e2eAuthRouteImplRelativePath,
    },
  },

  // Image optimization configuration for external domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Google profile pictures
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com', // GitHub avatars
      },
    ],
  },

  // Performance optimizations
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@tanstack/react-query',
      'date-fns',
      'framer-motion',
      '@radix-ui/react-accordion',
      '@radix-ui/react-avatar',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@codemirror/lang-javascript',
      '@codemirror/lang-python',
      '@codemirror/lang-sql',
      '@codemirror/lang-css',
      '@codemirror/lang-html',
      '@codemirror/lang-markdown',
      '@codemirror/lang-json',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
    ],
    serverActions: {
      bodySizeLimit: '16mb',
    },
  },

  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? true
        : false,
  },

  poweredByHeader: false,
  reactStrictMode: true,
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@/app/api/e2e/auth/route-impl": e2eAuthRouteImplAbsolutePath,
    };
    return config;
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
