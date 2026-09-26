"use client";

import { CameraOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CameraScanError, startCameraScanner, type CameraScanner } from "@/lib/barcode/camera";

/**
 * Camera scanning for phones and tablets. Detected codes go to `onScan` — the same path as a
 * keyboard-wedge scanner — and the dialog stays open for the next item.
 */
export function CameraDialog({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan with camera</DialogTitle>
          <DialogDescription>Point the camera at a barcode. Each item is added once; hold the next one in view.</DialogDescription>
        </DialogHeader>
        {open && <CameraView onScan={onScan} />}
        <Button variant="outline" className="h-11" onClick={onClose}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CameraView({ onScan }: { onScan: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let scanner: CameraScanner | null = null;
    let cancelled = false;
    if (!video.current) return;
    startCameraScanner(video.current, (code) => {
      setLast(code);
      onScanRef.current(code);
    })
      .then((s) => {
        if (cancelled) s.stop();
        else scanner = s;
      })
      .catch((e: unknown) => setError(e instanceof CameraScanError ? e.message : String(e)));
    return () => {
      cancelled = true;
      scanner?.stop();
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg bg-muted p-6 text-center text-sm" role="alert">
        <CameraOffIcon className="size-8 text-muted-foreground" />
        {error}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <video ref={video} className="aspect-video w-full rounded-lg bg-black object-cover" muted playsInline />
      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        {last ? `Last scanned: ${last}` : "Looking for a barcode…"}
      </p>
    </div>
  );
}
