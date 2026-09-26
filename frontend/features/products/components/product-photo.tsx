"use client";

import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useRemoveProductImage, useSetProductImage } from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";
import { ACCEPTED_PHOTO_TYPES, resizePhoto } from "@/lib/images/resize";
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
        // eslint-disable-next-line @next/next/no-img-element -- already resized client-side; served by the API
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover" onError={() => setFailedSrc(src)} />
      ) : (
        <ImageIcon className="size-1/2" aria-hidden />
      )}
    </div>
  );
}

/** Photo preview with upload/replace/remove controls for the product detail page. */
export function ProductPhotoEditor({
  productId,
  name,
  imageUrl,
  canEdit,
}: {
  productId: string;
  name: string;
  imageUrl: string | null;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const upload = useSetProductImage(productId);
  const remove = useRemoveProductImage(productId);
  const busy = processing || upload.isPending || remove.isPending;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProcessing(true);
    try {
      const photo = await resizePhoto(file);
      await upload.mutateAsync(photo);
      toast.success("Photo saved");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async () => {
    try {
      await remove.mutateAsync();
      toast.success("Photo removed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex items-center gap-4">
      <ProductThumb src={imageUrl} alt={name} className="size-24" />
      {canEdit && (
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_PHOTO_TYPES.join(",")}
            className="sr-only"
            aria-label="Product photo"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <UploadIcon />
            {busy && !remove.isPending ? "Uploading…" : imageUrl ? "Replace photo" : "Upload photo"}
          </Button>
          {imageUrl && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onRemove()}>
              <Trash2Icon />
              Remove
            </Button>
          )}
          <p className="text-muted-foreground text-xs">JPEG, PNG or WebP. Resized automatically.</p>
        </div>
      )}
    </div>
  );
}
