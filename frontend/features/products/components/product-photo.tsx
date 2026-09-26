"use client";

import { Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ProductThumb } from "@/components/shared/product-thumb";
import { Button } from "@/components/ui/button";
import { useRemoveProductImage, useSetProductImage } from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";
import { ACCEPTED_PHOTO_TYPES, resizePhoto } from "@/lib/images/resize";

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
