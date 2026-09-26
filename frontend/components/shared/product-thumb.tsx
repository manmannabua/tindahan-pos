"use client";

import { ImageIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Square product photo, or a neutral placeholder icon when there is none (or it fails to load). */
export function ProductThumb({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src && src !== failedSrc;
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border",
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- already resized on upload; served by the API
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover" onError={() => setFailedSrc(src)} />
      ) : (
        <ImageIcon className="size-1/2 max-h-12 max-w-12 opacity-60" aria-hidden />
      )}
    </div>
  );
}
