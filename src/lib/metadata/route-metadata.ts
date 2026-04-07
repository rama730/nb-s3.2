import type { Metadata } from "next";

export const DEFAULT_ROUTE_OG_IMAGE = "/og/routes-card.png";

type RouteMetadataOptions = {
  title: string;
  description: string;
  path: string;
  image?: string | null;
};

function normalizeRoutePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveRouteImage(image?: string | null) {
  if (!image || !image.trim()) return [DEFAULT_ROUTE_OG_IMAGE];
  return [image];
}

export function buildRouteMetadata({
  title,
  description,
  path,
  image,
}: RouteMetadataOptions): Metadata {
  const canonicalPath = normalizeRoutePath(path);
  const images = resolveRouteImage(image);

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonicalPath,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  };
}
