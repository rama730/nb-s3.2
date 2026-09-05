import type { MetadataRoute } from "next";

import { LEGAL_VERSIONS } from "@/lib/legal/versions";

const SITE_ORIGIN = "https://networkbase.in";

const PUBLIC_LEGAL_PATHS = [
  "/privacy",
  "/terms",
  "/eula",
  "/acceptable-use",
  "/cookies",
  "/subprocessors",
  "/copyright",
  "/grievances",
  "/security-reporting",
  "/dpa",
  "/open-source",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(`${LEGAL_VERSIONS.privacy}T00:00:00.000Z`);

  return PUBLIC_LEGAL_PATHS.map((path) => ({
    url: `${SITE_ORIGIN}${path}`,
    lastModified,
    changeFrequency: "yearly",
    priority: path === "/privacy" || path === "/terms" ? 0.6 : 0.4,
  }));
}
