import { afterEach, describe, expect, it, vi } from "vitest";

import { DRAWER_KICK, encodeDrawerKick, encodeReceipt, toPrinterText } from "./escpos";
import { sendToPrinter } from "./escpos-transport";
import type { ReceiptDocument } from "./receipt";

vi.mock("./print", () => ({ printReceipt: vi.fn().mockResolvedValue(undefined) }));

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const INIT = [0x1b, 0x40, 0x1b, 0x74, 0x00];
const TAIL = [0x1b, 0x64, 3, 0x1d, 0x56, 66, 3];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ESC/POS encoder", () => {
  it("encodes a small receipt byte for byte", () => {
    const doc: ReceiptDocument = {
      width: 58,
      lines: [
        { kind: "center", text: "HI", bold: true },
        { kind: "pair", left: "A", right: "1" },
        { kind: "barcode", value: "X1" },
      ],
    };
    expect([...encodeReceipt(doc)]).toEqual([
      ...INIT,
      0x1b, 0x45, 1, ...ascii(" ".repeat(15) + "HI"), 0x0a, // bold, centred on 32 columns
      0x1b, 0x45, 0, ...ascii("A" + " ".repeat(30) + "1"), 0x0a,
      0x1b, 0x61, 1, 0x1d, 0x68, 60, 0x1d, 0x77, 2, 0x1d, 0x48, 2, 0x1d, 0x6b, 73, 4, 0x7b, 0x42, ...ascii("X1"), 0x0a, 0x1b, 0x61, 0,
      ...TAIL,
    ]);
  });

  it("wraps like the on-screen layout and transliterates non-ASCII", () => {
    const doc: ReceiptDocument = { width: 58, lines: [{ kind: "text", text: "Sardinas ₱25 — jalapeño in tomato sauce 155g" }] };
    const text = String.fromCharCode(...encodeReceipt(doc).slice(INIT.length, -TAIL.length));
    expect(text).toBe("Sardinas P25 - jalapeno in\ntomato sauce 155g\n");
    expect(toPrinterText("“Café” ×2 …")).toBe('"Cafe" x2 ...');
    expect(toPrinterText("中")).toBe("?");
  });

  it("kicks the drawer before printing when asked, and on its own", () => {
    const bytes = [...encodeReceipt({ width: 80, lines: [] }, { kickDrawer: true })];
    expect(bytes).toEqual([...INIT, 0x1b, 0x70, 0x00, 25, 250, ...TAIL]);
    expect([...encodeDrawerKick()]).toEqual([...INIT, ...DRAWER_KICK]);
  });
});

describe("ESC/POS transports", () => {
  it("writes to the paired USB printer's bulk OUT endpoint in chunks", async () => {
    const transferOut = vi.fn().mockResolvedValue({});
    const device = {
      opened: false,
      configuration: {
        interfaces: [
          { interfaceNumber: 0, alternate: { interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 2, direction: "out", type: "bulk" }] } },
        ],
      },
      open: vi.fn().mockImplementation(async () => {
        device.opened = true;
      }),
      selectConfiguration: vi.fn(),
      claimInterface: vi.fn().mockResolvedValue(undefined),
      transferOut,
    };
    vi.stubGlobal("navigator", { usb: { getDevices: async () => [device], requestDevice: vi.fn() } });
    await sendToPrinter("escpos-usb", new Uint8Array(5000));
    expect(device.open).toHaveBeenCalled();
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(transferOut.mock.calls.map(([ep, data]) => [ep, (data as Uint8Array).length])).toEqual([
      [2, 4096],
      [2, 904],
    ]);
  });

  it("writes to the serial port at the configured baud rate", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const port = {
      readable: null,
      writable: null as unknown,
      open: vi.fn().mockImplementation(async () => {
        port.writable = { getWriter: () => ({ write, releaseLock: vi.fn() }) };
      }),
    };
    vi.stubGlobal("navigator", { serial: { getPorts: async () => [port], requestPort: vi.fn() } });
    await sendToPrinter("escpos-serial", Uint8Array.of(1, 2, 3), { baudRate: 19200 });
    expect(port.open).toHaveBeenCalledWith({ baudRate: 19200 });
    expect(write).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
  });

  it("fails clearly with no paired printer or no browser support", async () => {
    vi.stubGlobal("navigator", { usb: { getDevices: async () => [], requestDevice: vi.fn() } });
    await expect(sendToPrinter("escpos-usb", new Uint8Array(1))).rejects.toThrow("No USB printer paired");
    await expect(sendToPrinter("escpos-serial", new Uint8Array(1))).rejects.toThrow("cannot talk to the printer directly");
  });
});

describe("printDocument", () => {
  const doc: ReceiptDocument = { width: 58, lines: [{ kind: "text", text: "x" }] };

  it("falls back to browser printing when the ESC/POS printer is unavailable", async () => {
    const { printDocument, openCashDrawer } = await import("./output");
    const { printReceipt } = await import("./print");
    vi.stubGlobal("navigator", {});
    const outcome = await printDocument(doc, { printerMode: "escpos-usb", serialBaudRate: 9600 }, { kickDrawer: true });
    expect(outcome.fallbackReason).toContain("cannot talk to the printer directly");
    expect(printReceipt).toHaveBeenCalledWith(doc);
    expect(await openCashDrawer({ printerMode: "escpos-usb", serialBaudRate: 9600 })).toBe(false);
    expect(await openCashDrawer({ printerMode: "browser", serialBaudRate: 9600 })).toBe(false);
  });

  it("sends ESC/POS bytes (with the drawer kick) when the printer is there", async () => {
    const { printDocument } = await import("./output");
    const { printReceipt } = await import("./print");
    vi.mocked(printReceipt).mockClear();
    const write = vi.fn().mockResolvedValue(undefined);
    const port = { readable: null, writable: { getWriter: () => ({ write, releaseLock: vi.fn() }) }, open: vi.fn() };
    vi.stubGlobal("navigator", { serial: { getPorts: async () => [port], requestPort: vi.fn() } });
    const outcome = await printDocument(doc, { printerMode: "escpos-serial", serialBaudRate: 9600 }, { kickDrawer: true });
    expect(outcome.fallbackReason).toBeNull();
    expect(printReceipt).not.toHaveBeenCalled();
    const sent = [...(write.mock.calls[0][0] as Uint8Array)];
    expect(sent.slice(INIT.length, INIT.length + 5)).toEqual([...DRAWER_KICK]);
  });
});
