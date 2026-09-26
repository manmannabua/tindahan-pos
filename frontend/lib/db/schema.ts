/**
 * The POS terminal's local database (IndexedDB via Dexie). See docs/DATABASE.md §4.
 *
 * This is the operational database of one terminal: the checkout path reads and writes only
 * here. Money and quantities are decimal strings (see lib/money). Timestamps are ISO strings.
 * Catalog rows mirror the pull shapes (backend/app/modules/sync/pull_schemas.py) in camelCase.
 *
 * MIGRATIONS: version 1 is what ships to terminals from Phase 3/4 on. From now on never edit an
 * existing `version()`; add a new one with an `upgrade()` that preserves unsynced `outbox` rows.
 */
import Dexie, { type EntityTable } from "dexie";

type UUID = string;
type DecimalString = string;
type ISODateTime = string;

// --- Metadata & settings -------------------------------------------------------------------

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

// --- Catalog (downloaded from the server; read-only on the terminal) ------------------------

export interface LocalProduct {
  id: UUID;
  name: string;
  categoryId: UUID | null;
  brandId: UUID | null;
  baseUnitId: UUID;
  taxRateId: UUID;
  trackInventory: boolean;
  imageUrl: string | null;
  isActive: boolean;
}

export interface LocalVariant {
  id: UUID;
  productId: UUID;
  sku: string;
  name: string | null;
  attributes: Record<string, unknown>;
  reorderPoint: DecimalString | null;
  isDefault: boolean;
  isActive: boolean;
  /** Lowercased words of product/variant name and SKU, for instant prefix search. */
  searchTokens: string[];
}

export interface LocalBarcode {
  id: UUID;
  /** Canonical code as stored by the server. Unique: this is the scan index. */
  code: string;
  variantId: UUID;
  productUnitId: UUID;
  symbology: string;
  isPrimary: boolean;
  isActive: boolean;
}

export interface LocalProductUnit {
  id: UUID;
  productId: UUID;
  unitId: UUID;
  /** How many base units one of this unit contains. */
  factor: DecimalString;
  isBase: boolean;
  isActive: boolean;
}

export interface LocalPrice {
  id: UUID;
  variantId: UUID;
  productUnitId: UUID;
  priceLevelId: UUID;
  branchId: UUID | null;
  minQuantity: DecimalString;
  price: DecimalString;
  isActive: boolean;
}

export interface LocalCategory {
  id: UUID;
  parentId: UUID | null;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface LocalBrand {
  id: UUID;
  name: string;
  isActive: boolean;
}

export interface LocalUnit {
  id: UUID;
  code: string;
  name: string;
  allowsDecimal: boolean;
  isActive: boolean;
}

export type TaxKind = "VATABLE" | "EXEMPT" | "ZERO_RATED";

export interface LocalTaxRate {
  id: UUID;
  code: string;
  name: string;
  rate: DecimalString;
  kind: TaxKind;
  isDefault: boolean;
  isActive: boolean;
}

export interface LocalPriceLevel {
  id: UUID;
  code: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
}

export type PaymentKind = "CASH" | "EWALLET" | "CARD" | "BANK" | "OTHER";

export interface LocalPaymentMethod {
  id: UUID;
  code: string;
  name: string;
  kind: PaymentKind;
  requiresReference: boolean;
  opensDrawer: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface LocalStockLocation {
  id: UUID;
  branchId: UUID;
  code: string;
  name: string;
  locationType: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface LocalCompany {
  id: UUID;
  code: string;
  name: string;
  legalName: string | null;
  tin: string | null;
  currency: string;
  timezone: string;
  pricesIncludeTax: boolean;
  settings: Record<string, unknown>;
}

export interface LocalBranch {
  id: UUID;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  tin: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  isActive: boolean;
}

export interface LocalInventory {
  stockLocationId: UUID;
  variantId: UUID;
  /** Last server balance (base units). */
  serverQuantity: DecimalString;
  /** Server balance + provisional local movements not yet reflected by the server. */
  quantity: DecimalString;
  updatedAt: ISODateTime;
}

export interface LocalCustomer {
  id: UUID;
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  priceLevelId: UUID | null;
  isActive: boolean;
  searchTokens: string[];
}

/** Promotion as downloaded (snake_case wire shape); evaluated by a later phase. */
export interface LocalPromotion {
  id: UUID;
  isActive: boolean;
  data: unknown;
}

/** Offline login verifier + permission snapshot. See docs/SECURITY.md §4. */
export interface LocalStaff {
  id: UUID;
  username: string;
  fullName: string;
  isActive: boolean;
  canUsePos: boolean;
  permissions: string[];
  pinSalt: string | null;
  pinVerifier: string | null;
  pinIterations: number | null;
  pinUpdatedAt: ISODateTime | null;
}

// --- Transactions (created on the terminal) -----------------------------------------------

export type LocalSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "CONFLICT";

export interface LocalDiscount {
  kind: "PERCENT" | "AMOUNT";
  value: DecimalString;
  reason: string | null;
  authorizedById: UUID | null;
}

export interface LocalSale {
  id: UUID;
  receiptNumber: string;
  cashSessionId: UUID | null;
  cashierId: UUID;
  cashierName: string;
  customerId: UUID | null;
  priceLevelId: UUID;
  stockLocationId: UUID;
  status: "COMPLETED" | "VOIDED";
  pricesIncludeTax: boolean;
  orderDiscount: LocalDiscount | null;
  grossTotal: DecimalString;
  lineDiscountTotal: DecimalString;
  orderDiscountTotal: DecimalString;
  discountTotal: DecimalString;
  taxTotal: DecimalString;
  total: DecimalString;
  paidTotal: DecimalString;
  changeTotal: DecimalString;
  vatableSales: DecimalString;
  vatAmount: DecimalString;
  exemptSales: DecimalString;
  zeroRatedSales: DecimalString;
  occurredAt: ISODateTime;
  syncStatus: LocalSyncStatus;
  /** Set when voided on this terminal (optional: absent on rows written before v2). */
  voidedAt?: ISODateTime | null;
  voidedById?: UUID | null;
  voidReason?: string | null;
}

export interface LocalSaleItem {
  id: UUID;
  saleId: UUID;
  lineNo: number;
  variantId: UUID;
  productUnitId: UUID;
  unitCode: string;
  unitFactor: DecimalString;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  quantity: DecimalString;
  baseQuantity: DecimalString;
  unitPrice: DecimalString;
  originalUnitPrice: DecimalString | null;
  priceOverriddenById: UUID | null;
  discount: LocalDiscount | null;
  /** Promotion that produced `discount` (not indexed; optional for rows from older versions). */
  promotionId?: UUID | null;
  taxRateId: UUID | null;
  taxRate: DecimalString;
  taxKind: TaxKind;
  gross: DecimalString;
  lineDiscount: DecimalString;
  orderDiscountShare: DecimalString;
  net: DecimalString;
  taxAmount: DecimalString;
  total: DecimalString;
}

export interface LocalPayment {
  id: UUID;
  saleId: UUID;
  paymentMethodId: UUID;
  methodName: string;
  methodKind: PaymentKind;
  amount: DecimalString;
  tendered: DecimalString | null;
  change: DecimalString;
  referenceNo: string | null;
  occurredAt: ISODateTime;
}

export interface LocalCashSession {
  id: UUID;
  status: "OPEN" | "CLOSED";
  openedBy: UUID;
  openedAt: ISODateTime;
  openingFloat: DecimalString;
  closedBy: UUID | null;
  closedAt: ISODateTime | null;
  countedCash: DecimalString | null;
  expectedCash: DecimalString | null;
  overShort: DecimalString | null;
  note: string | null;
}

export type CashMovementType = "CASH_IN" | "CASH_OUT" | "PICKUP";

export interface LocalCashMovement {
  id: UUID;
  cashSessionId: UUID;
  movementType: CashMovementType;
  amount: DecimalString;
  reason: string | null;
  userId: UUID;
  authorizedById: UUID | null;
  occurredAt: ISODateTime;
}

/** Provisional movement; replaced by server balances after sync. See INVENTORY_LEDGER.md §7. */
export interface LocalInventoryMovement {
  id: UUID;
  variantId: UUID;
  stockLocationId: UUID;
  signedQuantity: DecimalString;
  movementType: string;
  referenceId: UUID;
  occurredAt: ISODateTime;
  /** When the server acknowledged the operation that contains this movement. */
  ackedAt: ISODateTime | null;
}

export interface HeldCart {
  id: UUID;
  label: string;
  heldAt: ISODateTime;
  heldBy: UUID;
  cart: unknown;
}

export interface ActiveCartCheckpoint {
  id: "current";
  cart: unknown;
  updatedAt: ISODateTime;
}

/** A customer return against a local sale (Phase 7, schema v2). */
export interface LocalReturn {
  id: UUID;
  saleId: UUID;
  returnNumber: string;
  cashSessionId: UUID | null;
  cashierId: UUID;
  cashierName: string;
  authorizedById: UUID | null;
  reason: string;
  refundTotal: DecimalString;
  occurredAt: ISODateTime;
  syncStatus: LocalSyncStatus;
}

export interface LocalReturnItem {
  id: UUID;
  returnId: UUID;
  saleItemId: UUID;
  variantId: UUID;
  productName: string;
  unitCode: string;
  quantity: DecimalString;
  baseQuantity: DecimalString;
  refundAmount: DecimalString;
  restock: boolean;
}

export interface LocalRefund {
  id: UUID;
  returnId: UUID;
  paymentMethodId: UUID;
  methodName: string;
  methodKind: PaymentKind;
  amount: DecimalString;
  referenceNo: string | null;
}

// --- Sync ------------------------------------------------------------------------------------

export type OutboxStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";

/** A pending sync operation. See docs/SYNC_PROTOCOL.md §2. */
export interface OutboxEntry {
  seq?: number;
  operationId: UUID;
  deviceId: UUID;
  entityType: string;
  entityId: UUID;
  operation: string;
  payload: unknown;
  /** Lower is sent first. */
  priority: number;
  createdAt: ISODateTime;
  attemptCount: number;
  lastAttemptAt: ISODateTime | null;
  /** Earliest time of the next attempt (backoff). Empty string = immediately (indexable). */
  nextAttemptAt: ISODateTime | null;
  status: OutboxStatus;
  error: { code: string; message: string } | null;
  syncedAt: ISODateTime | null;
}

export const DB_NAME = "pos-terminal";

export class PosDatabase extends Dexie {
  meta!: EntityTable<MetaRow, "key">;
  settings!: EntityTable<SettingRow, "key">;
  products!: EntityTable<LocalProduct, "id">;
  variants!: EntityTable<LocalVariant, "id">;
  barcodes!: EntityTable<LocalBarcode, "id">;
  productUnits!: EntityTable<LocalProductUnit, "id">;
  prices!: EntityTable<LocalPrice, "id">;
  categories!: EntityTable<LocalCategory, "id">;
  brands!: EntityTable<LocalBrand, "id">;
  units!: EntityTable<LocalUnit, "id">;
  taxRates!: EntityTable<LocalTaxRate, "id">;
  priceLevels!: EntityTable<LocalPriceLevel, "id">;
  paymentMethods!: EntityTable<LocalPaymentMethod, "id">;
  stockLocations!: EntityTable<LocalStockLocation, "id">;
  inventory!: Dexie.Table<LocalInventory, [string, string]>;
  customers!: EntityTable<LocalCustomer, "id">;
  promotions!: EntityTable<LocalPromotion, "id">;
  staff!: EntityTable<LocalStaff, "id">;
  sales!: EntityTable<LocalSale, "id">;
  saleItems!: EntityTable<LocalSaleItem, "id">;
  payments!: EntityTable<LocalPayment, "id">;
  cashSessions!: EntityTable<LocalCashSession, "id">;
  cashMovements!: EntityTable<LocalCashMovement, "id">;
  inventoryMovements!: EntityTable<LocalInventoryMovement, "id">;
  heldCarts!: EntityTable<HeldCart, "id">;
  activeCart!: EntityTable<ActiveCartCheckpoint, "id">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  returns!: EntityTable<LocalReturn, "id">;
  returnItems!: EntityTable<LocalReturnItem, "id">;
  refunds!: EntityTable<LocalRefund, "id">;

  constructor(name: string = DB_NAME) {
    super(name);
    // Only indexed fields are listed; other fields are stored but not indexed.
    this.version(1).stores({
      meta: "&key",
      settings: "&key",
      products: "id, categoryId, brandId",
      variants: "id, productId, sku, *searchTokens",
      barcodes: "id, &code, variantId",
      productUnits: "id, productId",
      prices: "id, variantId",
      categories: "id",
      brands: "id",
      units: "id",
      taxRates: "id",
      priceLevels: "id",
      paymentMethods: "id",
      stockLocations: "id",
      inventory: "[stockLocationId+variantId], variantId",
      customers: "id, phone, *searchTokens",
      promotions: "id",
      staff: "id, username",
      sales: "id, &receiptNumber, cashSessionId, occurredAt, syncStatus",
      saleItems: "id, saleId",
      payments: "id, saleId",
      cashSessions: "id, status",
      cashMovements: "id, cashSessionId",
      inventoryMovements: "id, variantId, referenceId, [stockLocationId+variantId]",
      heldCarts: "id, heldAt",
      activeCart: "&id",
      outbox: "++seq, &operationId, status, entityId, [status+priority+seq]",
    });
    // v2 (Phase 7): returns. Adding tables needs no data upgrade; unsynced outbox rows untouched.
    this.version(2).stores({
      returns: "id, saleId, cashSessionId, occurredAt, syncStatus",
      returnItems: "id, returnId, saleItemId",
      refunds: "id, returnId",
    });
  }
}

let instance: PosDatabase | null = null;

/** The terminal database (lazily opened, browser only). */
export function getDb(): PosDatabase {
  instance ??= new PosDatabase();
  return instance;
}

/** Tests only: point `getDb()` at another database. */
export function setDbForTests(db: PosDatabase | null): void {
  instance = db;
}
