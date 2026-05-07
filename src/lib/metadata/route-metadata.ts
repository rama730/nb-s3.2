import type { Metadata } from "next";

export const DEFAULT_ROUTE_OG_IMAGE = "/og/routes-card.png";

type RouteMetadataOptions = {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  twitterCard?: "summary" | "summary_large_image";
};

function normalizeRoutePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveRouteImage({
  image,
  alt,
  width,
  height,
}: {
  image?: string | null;
  alt?: string;
  width?: number;
  height?: number;
}) {
  const url = image?.trim() || DEFAULT_ROUTE_OG_IMAGE;
  if (!width || !height) return [{ url, alt }];
  return [{ url, width, height, alt }];
}

export function buildRouteMetadata({
  title,
  description,
  path,
  image,
  imageAlt,
  imageWidth,
  imageHeight,
  twitterCard = "summary_large_image",
}: RouteMetadataOptions): Metadata {
  const canonicalPath = normalizeRoutePath(path);
  const images = resolveRouteImage({
    image,
    alt: imageAlt ?? title,
    width: imageWidth,
    height: imageHeight,
  });

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
      card: twitterCard,
      title,
      description,
      images,
    },
  };
}
