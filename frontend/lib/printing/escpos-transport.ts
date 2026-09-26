/**
 * Byte transports to ESC/POS printers: WebUSB and WebSerial (Chromium only; feature-detected).
 *
 * The browser remembers devices the user paired once (`getDevices()` / `getPorts()`), so after
 * pairing the terminal prints without prompts, offline included. Pairing itself must happen in a
 * user gesture (a button in the terminal settings).
 */

// Minimal typings: WebUSB/WebSerial are not part of TypeScript's DOM lib.
interface UsbEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
}
interface UsbAlternate {
  interfaceClass: number;
  endpoints: UsbEndpoint[];
}
interface UsbInterface {
  interfaceNumber: number;
  alternate: UsbAlternate;
}
interface UsbDevice {
  productName?: string;
  opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<unknown>;
  forget?: () => Promise<void>;
}
interface Usb {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: { classCode?: number }[] }): Promise<UsbDevice>;
}
interface SerialPortLike {
  readable: unknown;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  forget?: () => Promise<void>;
}
interface Serial {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}
interface HardwareNavigator {
  usb?: Usb;
  serial?: Serial;
}

const hw = (): HardwareNavigator => (typeof navigator === "undefined" ? {} : (navigator as unknown as HardwareNavigator));

export type EscPosMode = "escpos-usb" | "escpos-serial";

export class PrinterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrinterUnavailableError";
  }
}

export function isSupported(mode: EscPosMode): boolean {
  return mode === "escpos-usb" ? Boolean(hw().usb) : Boolean(hw().serial);
}

const PRINTER_CLASS = 7;
const CHUNK = 4096;

async function usbWrite(device: UsbDevice, data: Uint8Array): Promise<void> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const interfaces = device.configuration?.interfaces ?? [];
  const iface =
    interfaces.find((i) => i.alternate.interfaceClass === PRINTER_CLASS) ??
    interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === "out" && e.type === "bulk"));
  const endpoint = iface?.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
  if (!iface || !endpoint) throw new PrinterUnavailableError("The USB device has no printer output");
  try {
    await device.claimInterface(iface.interfaceNumber);
  } catch {
    // Already claimed by this page: fine.
  }
  for (let i = 0; i < data.length; i += CHUNK) {
    await device.transferOut(endpoint.endpointNumber, data.slice(i, i + CHUNK));
  }
}

async function serialWrite(port: SerialPortLike, data: Uint8Array, baudRate: number): Promise<void> {
  if (!port.writable) await port.open({ baudRate });
  const writer = port.writable?.getWriter();
  if (!writer) throw new PrinterUnavailableError("Serial port is not writable");
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}

/** Send bytes to the paired printer. Throws PrinterUnavailableError if none is paired/supported. */
export async function sendToPrinter(mode: EscPosMode, data: Uint8Array, options: { baudRate?: number } = {}): Promise<void> {
  if (!isSupported(mode)) throw new PrinterUnavailableError("This browser cannot talk to the printer directly");
  if (mode === "escpos-usb") {
    const [device] = (await hw().usb?.getDevices()) ?? [];
    if (!device) throw new PrinterUnavailableError("No USB printer paired");
    await usbWrite(device, data);
    return;
  }
  const [port] = (await hw().serial?.getPorts()) ?? [];
  if (!port) throw new PrinterUnavailableError("No serial printer paired");
  await serialWrite(port, data, options.baudRate ?? 9600);
}

/** Ask the user to choose a printer (must run inside a click handler). Returns its name. */
export async function pairPrinter(mode: EscPosMode): Promise<string> {
  if (!isSupported(mode)) throw new PrinterUnavailableError("This browser cannot talk to the printer directly");
  if (mode === "escpos-usb") {
    const device = await hw().usb!.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] });
    return device.productName ?? "USB printer";
  }
  await hw().serial!.requestPort();
  return "Serial printer";
}

export async function forgetPrinters(mode: EscPosMode): Promise<void> {
  if (mode === "escpos-usb") {
    for (const d of (await hw().usb?.getDevices()) ?? []) await d.forget?.();
  } else {
    for (const p of (await hw().serial?.getPorts()) ?? []) await p.forget?.();
  }
}

export async function pairedPrinter(mode: EscPosMode): Promise<string | null> {
  if (!isSupported(mode)) return null;
  if (mode === "escpos-usb") {
    const [device] = (await hw().usb?.getDevices()) ?? [];
    return device ? (device.productName ?? "USB printer") : null;
  }
  const [port] = (await hw().serial?.getPorts()) ?? [];
  return port ? "Serial printer" : null;
}
