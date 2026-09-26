/**
 * Audible scan feedback with Web Audio (no audio files needed, works offline).
 * Success: one short high beep. Error: two low beeps. See docs/BARCODE_SCANNER.md §6.
 */
let context: AudioContext | null = null;

function tone(ctx: AudioContext, frequency: number, start: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.05;
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration);
}

export function beep(kind: "ok" | "error", enabled = true): void {
  if (!enabled || typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
  try {
    context ??= new window.AudioContext();
    if (kind === "ok") tone(context, 1760, 0, 0.07);
    else {
      tone(context, 330, 0, 0.12);
      tone(context, 330, 0.18, 0.12);
    }
  } catch {
    // Audio is a nicety; never let it break checkout.
  }
}
