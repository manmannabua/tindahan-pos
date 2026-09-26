import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScannerDetector, type ScannerDetectorOptions } from "./scanner-detector";

/** Feed `text` with a fixed gap between keys, starting at `start` ms. Returns the end time. */
function type(detector: ScannerDetector, text: string, gapMs: number, start = 1000): number {
  let t = start;
  for (const ch of text) {
    detector.handleKey(ch, t);
    t += gapMs;
  }
  return t - gapMs;
}

function setup(options: Partial<ScannerDetectorOptions> = {}) {
  const scans: string[] = [];
  const detector = new ScannerDetector((code) => scans.push(code), options);
  return { detector, scans };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScannerDetector", () => {
  it("emits a fast sequence terminated by Enter", () => {
    const { detector, scans } = setup();
    const end = type(detector, "4800361419117", 8);
    expect(detector.handleKey("Enter", end + 8)).toBe("scan");
    expect(scans).toEqual(["4800361419117"]);
  });

  it("supports Tab as a terminator", () => {
    const { detector, scans } = setup();
    const end = type(detector, "ABC-123", 5);
    detector.handleKey("Tab", end + 5);
    expect(scans).toEqual(["ABC-123"]);
  });

  it("ignores human-speed typing", () => {
    const { detector, scans } = setup();
    const end = type(detector, "12345678", 150);
    expect(detector.handleKey("Enter", end + 150)).toBe("ignored");
    vi.advanceTimersByTime(500);
    expect(scans).toEqual([]);
  });

  it("requires the minimum length", () => {
    const { detector, scans } = setup({ minLength: 4 });
    const end = type(detector, "123", 5);
    expect(detector.handleKey("Enter", end + 5)).toBe("ignored");
    expect(scans).toEqual([]);
  });

  it("emits after an idle timeout when the scanner sends no suffix", () => {
    const { detector, scans } = setup({ idleTimeoutMs: 80 });
    type(detector, "036000291452", 6);
    expect(scans).toEqual([]);
    vi.advanceTimersByTime(79);
    expect(scans).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(scans).toEqual(["036000291452"]);
  });

  it("does not emit on idle when disabled", () => {
    const { detector, scans } = setup({ idleTimeoutMs: 0 });
    type(detector, "036000291452", 6);
    vi.advanceTimersByTime(1000);
    expect(scans).toEqual([]);
  });

  it("starts a new buffer after a long pause", () => {
    const { detector, scans } = setup();
    // A human types "9", pauses, then the scanner fires the real code.
    detector.handleKey("9", 0);
    const end = type(detector, "96385074", 7, 500);
    detector.handleKey("Enter", end + 7);
    expect(scans).toEqual(["96385074"]);
  });

  it("ignores modifier keys without breaking the buffer", () => {
    const { detector, scans } = setup();
    let t = 0;
    for (const key of ["Shift", "A", "Shift", "B", "1", "2"]) {
      detector.handleKey(key, (t += 4));
    }
    detector.handleKey("Enter", (t += 4));
    expect(scans).toEqual(["AB12"]);
  });

  it("reports likely scanning after two fast characters", () => {
    const { detector } = setup();
    detector.handleKey("1", 0);
    expect(detector.isLikelyScanning()).toBe(false);
    detector.handleKey("2", 5);
    expect(detector.isLikelyScanning()).toBe(true);
  });

  it("emits consecutive scans separately", () => {
    const { detector, scans } = setup();
    let end = type(detector, "11112222", 5, 0);
    detector.handleKey("Enter", end + 5);
    end = type(detector, "33334444", 5, end + 300);
    detector.handleKey("Enter", end + 5);
    expect(scans).toEqual(["11112222", "33334444"]);
  });
});
