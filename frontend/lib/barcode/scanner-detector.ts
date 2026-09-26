/**
 * Distinguishes HID barcode-scanner input from human typing by keystroke timing.
 * See docs/BARCODE_SCANNER.md §3.
 *
 * Framework-free and clock-injectable so it can be unit-tested with exact timestamps.
 * Scanners type ~50–500 chars/s (gaps of 2–20 ms); humans ~5–10 chars/s (gaps of 100+ ms).
 */

export interface ScannerDetectorOptions {
  /** Shortest code accepted as a scan. */
  minLength: number;
  /** A gap longer than this between two characters starts a new buffer. */
  maxInterKeyMs: number;
  /** The average gap across the whole code must be at most this to count as a scan. */
  maxAvgInterKeyMs: number;
  /**
   * Emit after this much silence even without a terminator (scanners configured with no
   * suffix). 0 disables idle emission.
   */
  idleTimeoutMs: number;
  /** Keys (KeyboardEvent.key) that end a scan. */
  terminators: readonly string[];
}

export const DEFAULT_SCANNER_OPTIONS: ScannerDetectorOptions = {
  minLength: 4,
  maxInterKeyMs: 50,
  maxAvgInterKeyMs: 30,
  idleTimeoutMs: 80,
  terminators: ["Enter", "Tab"],
};

/**
 * - `ignored`: not part of a scan (modifier key, human-speed terminator)
 * - `buffered`: printable character appended to the current buffer
 * - `scan`: this key completed a scan; `onScan` has been called
 */
export type KeyResult = "ignored" | "buffered" | "scan";

export interface TimerApi {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ScannerDetector {
  private readonly options: ScannerDetectorOptions;
  private chars: string[] = [];
  private firstAt = 0;
  private lastAt = 0;
  private idleTimer: unknown = null;

  constructor(
    private readonly onScan: (code: string) => void,
    options: Partial<ScannerDetectorOptions> = {},
    private readonly timers: TimerApi = defaultTimers,
  ) {
    this.options = { ...DEFAULT_SCANNER_OPTIONS, ...options };
  }

  handleKey(key: string, timestamp: number): KeyResult {
    if (this.options.terminators.includes(key)) {
      const scanned = this.isScanLike();
      const code = this.chars.join("");
      this.reset();
      if (scanned) {
        this.onScan(code);
        return "scan";
      }
      return "ignored";
    }

    // Modifiers (Shift for uppercase letters), arrows, F-keys: not characters.
    if (key.length !== 1) return "ignored";

    if (this.chars.length > 0 && timestamp - this.lastAt > this.options.maxInterKeyMs) {
      this.reset();
    }
    if (this.chars.length === 0) this.firstAt = timestamp;
    this.chars.push(key);
    this.lastAt = timestamp;
    this.scheduleIdle();
    return "buffered";
  }

  /** True once at least two characters have arrived at scanner speed. */
  isLikelyScanning(): boolean {
    return this.chars.length >= 2 && this.averageGap() <= this.options.maxAvgInterKeyMs;
  }

  reset(): void {
    this.chars = [];
    this.firstAt = 0;
    this.lastAt = 0;
    this.clearIdle();
  }

  dispose(): void {
    this.reset();
  }

  private isScanLike(): boolean {
    return (
      this.chars.length >= this.options.minLength &&
      this.averageGap() <= this.options.maxAvgInterKeyMs
    );
  }

  private averageGap(): number {
    if (this.chars.length < 2) return 0;
    return (this.lastAt - this.firstAt) / (this.chars.length - 1);
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (this.options.idleTimeoutMs <= 0) return;
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = null;
      if (this.isScanLike()) {
        const code = this.chars.join("");
        this.reset();
        this.onScan(code);
      } else {
        this.reset();
      }
    }, this.options.idleTimeoutMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) {
      this.timers.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
