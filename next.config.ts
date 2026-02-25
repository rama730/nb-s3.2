import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Turbopack configuration - use absolute path to silence warning
  turbopack: {
    root: path.resolve(__dirname),
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
  },

  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },

  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
