/**
 * Camera barcode scanning for phones/tablets. See docs/BARCODE_SCANNER.md §7.
 *
 * - Native `BarcodeDetector` when the browser has it (Chrome on Android, recent Safari).
 * - Otherwise @zxing/browser, loaded lazily so it never enlarges the main POS bundle.
 * - Every detected code goes through a duplicate filter (the same code within 1.5 s is ignored,
 *   so holding the camera still doesn't add ten items) and then into the same `onScan` path as
 *   a keyboard scanner.
 */

export const DUPLICATE_WINDOW_MS = 1500;

/** Suppress repeats of the same code within `windowMs`. */
export class DuplicateFilter {
  private lastCode: string | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs = DUPLICATE_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  accept(code: string): boolean {
    const t = this.now();
    if (code === this.lastCode && t - this.lastAt < this.windowMs) {
      this.lastAt = t; // keep suppressing while the same code stays in view
      return false;
    }
    this.lastCode = code;
    this.lastAt = t;
    return true;
  }
}

export interface CameraScanner {
  stop: () => void;
  engine: "native" | "zxing";
}

export type CameraError = "permission_denied" | "no_camera" | "unsupported" | "unknown";

export class CameraScanError extends Error {
  constructor(readonly reason: CameraError, message: string) {
    super(message);
    this.name = "CameraScanError";
  }
}

interface NativeDetector {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
interface NativeDetectorCtor {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const WANTED_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

function classify(error: unknown): CameraScanError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new CameraScanError("permission_denied", "Camera permission was denied. Allow camera access in the browser settings.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new CameraScanError("no_camera", "No camera was found on this device.");
  }
  return new CameraScanError("unknown", `Could not start the camera: ${String(error)}`);
}

export async function startCameraScanner(
  video: HTMLVideoElement,
  onScan: (code: string) => void,
  filter: DuplicateFilter = new DuplicateFilter(),
): Promise<CameraScanner> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraScanError("unsupported", "This browser cannot use the camera (HTTPS is required).");
  }
  const emit = (raw: string) => {
    const code = raw.trim();
    if (code && filter.accept(code)) onScan(code);
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (error) {
    throw classify(error);
  }
  const stopStream = () => stream.getTracks().forEach((t) => t.stop());

  const Native = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (Native) {
    const supported = (await Native.getSupportedFormats?.()) ?? WANTED_FORMATS;
    const detector = new Native({ formats: WANTED_FORMATS.filter((f) => supported.includes(f)) });
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    let running = true;
    const tick = async () => {
      if (!running) return;
      try {
        if (video.readyState >= 2) for (const found of await detector.detect(video)) emit(found.rawValue);
      } catch {
        // A frame that can't be decoded is normal; keep going.
      }
      if (running) setTimeout(() => void tick(), 150);
    };
    void tick();
    return {
      engine: "native",
      stop: () => {
        running = false;
        stopStream();
        video.srcObject = null;
      },
    };
  }

  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromStream(stream, video, (result) => {
    if (result) emit(result.getText());
  });
  return {
    engine: "zxing",
    stop: () => {
      controls.stop();
      stopStream();
    },
  };
}
