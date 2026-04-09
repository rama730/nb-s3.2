"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Image from "next/image";

import { buildIdentityPresentation, type IdentityRecord } from "@/lib/ui/identity";
import { cn } from "@/lib/utils";

export type UserAvatarProps = {
  identity: IdentityRecord;
  size?: number;
  className?: string;
  style?: CSSProperties;
  roundedClassName?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  priority?: boolean;
  unoptimized?: boolean;
  title?: string;
  sizes?: string;
  fallbackDisplayName?: string;
  fallbackInitials?: string;
};

export function UserAvatar({
  identity,
  size,
  className,
  style,
  roundedClassName = "rounded-full",
  imageClassName,
  fallbackClassName,
  priority = false,
  unoptimized = false,
  title,
  sizes,
  fallbackDisplayName,
  fallbackInitials,
}: UserAvatarProps) {
  const presentation = buildIdentityPresentation(identity, { fallbackDisplayName, fallbackInitials });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [presentation.avatarUrl]);

  const shouldRenderImage = Boolean(presentation.avatarUrl) && !imageFailed;

  return (
    <div
      title={title ?? presentation.displayName}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden",
        roundedClassName,
        className,
      )}
      style={size ? { width: size, height: size, ...style } : style}
    >
      {shouldRenderImage ? (
        <Image
          src={presentation.avatarUrl as string}
          alt={presentation.alt}
          fill
          unoptimized={unoptimized}
          sizes={sizes ?? (size ? `${size}px` : undefined)}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className={cn("object-cover", roundedClassName, imageClassName)}
          onError={() => setImageFailed(true)}
        />
      ) : null}

      {!shouldRenderImage ? (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-gradient-to-br text-white font-semibold",
            roundedClassName,
            presentation.gradientClass,
            fallbackClassName,
          )}
        >
          {presentation.initials}
        </div>
      ) : null}
    </div>
  );
}
