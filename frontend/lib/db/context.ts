/**
 * The terminal's selling context: company/branch settings, device identity and defaults.
 * Loaded from IndexedDB once per POS session.
 */
import { getMeta, getTerminalSettings, type DeviceIdentity, type TerminalSettings } from "./meta";
import type { LocalBranch, LocalCompany, LocalPaymentMethod, LocalPriceLevel, PosDatabase } from "./schema";

export interface PosContext {
  device: DeviceIdentity;
  company: LocalCompany;
  branch: LocalBranch;
  defaultPriceLevel: LocalPriceLevel;
  paymentMethods: LocalPaymentMethod[];
  settings: TerminalSettings;
}

export class TerminalNotReadyError extends Error {
  constructor() {
    super("This terminal has not been initialized for offline use.");
    this.name = "TerminalNotReadyError";
  }
}

export async function loadPosContext(db: PosDatabase): Promise<PosContext> {
  const [initStatus, device, companyRow, branchRow, levels, methods, settings] = await Promise.all([
    getMeta(db, "initStatus"),
    getMeta(db, "device"),
    db.settings.get("company"),
    db.settings.get("branch"),
    db.priceLevels.toArray(),
    db.paymentMethods.toArray(),
    getTerminalSettings(db),
  ]);
  const defaultPriceLevel = levels.find((l) => l.isDefault && l.isActive);
  if (initStatus !== "READY" || !device || !companyRow || !branchRow || !defaultPriceLevel) {
    throw new TerminalNotReadyError();
  }
  return {
    device,
    company: companyRow.value as LocalCompany,
    branch: branchRow.value as LocalBranch,
    defaultPriceLevel,
    paymentMethods: methods.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    settings,
  };
}
