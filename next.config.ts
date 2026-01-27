import type { NextConfig } from "next";
import path from "path";

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
    // Optimize package imports for faster builds
    optimizePackageImports: ['lucide-react', '@tanstack/react-query'],
  },

  // Strict mode for better development experience
  reactStrictMode: true,
};

export default nextConfig;
