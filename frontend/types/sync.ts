/**
 * Sync protocol wire types — mirrors backend/app/modules/sync/schemas.py and pull_schemas.py.
 * Money, quantities and rates are decimal strings; ids are UUID strings; times are ISO strings.
 */

// --- Pull rows (snake_case, one shape per table) -------------------------------------------

export interface CompanySync {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  tin: string | null;
  currency: string;
  timezone: string;
  prices_include_tax: boolean;
  /** BIR: "VAT REG TIN" vs "NON-VAT REG TIN" (optional: older servers omit it). */
  vat_registered?: boolean;
  bir_accreditation_no?: string | null;
  settings: Record<string, unknown>;
}

export interface BranchSync {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  tin: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  is_active: boolean;
}

export interface StockLocationSync {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  location_type: string;
  is_default: boolean;
  is_active: boolean;
}

export interface CategorySync {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface BrandSync {
  id: string;
  name: string;
  is_active: boolean;
}

export interface UnitSync {
  id: string;
  code: string;
  name: string;
  allows_decimal: boolean;
  is_active: boolean;
}

export interface TaxRateSync {
  id: string;
  code: string;
  name: string;
  rate: string;
  kind: "VATABLE" | "EXEMPT" | "ZERO_RATED";
  is_default: boolean;
  is_active: boolean;
}

export interface PriceLevelSync {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface PaymentMethodSync {
  id: string;
  code: string;
  name: string;
  kind: "CASH" | "EWALLET" | "CARD" | "BANK" | "OTHER";
  requires_reference: boolean;
  opens_drawer: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface ProductSync {
  id: string;
  name: string;
  category_id: string | null;
  brand_id: string | null;
  base_unit_id: string;
  tax_rate_id: string;
  track_inventory: boolean;
  sc_pwd_eligible?: boolean;
  image_url: string | null;
  is_active: boolean;
}

export interface ProductUnitSync {
  id: string;
  product_id: string;
  unit_id: string;
  factor: string;
  is_base: boolean;
  is_active: boolean;
}

export interface VariantSync {
  id: string;
  product_id: string;
  sku: string;
  name: string | null;
  attributes: Record<string, unknown>;
  reorder_point: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface BarcodeSync {
  id: string;
  variant_id: string;
  product_unit_id: string;
  code: string;
  symbology: string;
  is_primary: boolean;
  is_active: boolean;
}

export interface PriceSync {
  id: string;
  variant_id: string;
  product_unit_id: string;
  price_level_id: string;
  branch_id: string | null;
  min_quantity: string;
  price: string;
  is_active: boolean;
}

export interface InventoryBalanceSync {
  stock_location_id: string;
  variant_id: string;
  quantity: string;
  updated_at: string;
}

export interface CustomerSync {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  price_level_id: string | null;
  is_active: boolean;
}

/** Evaluated on the terminal by lib/promotions/evaluate.ts. */
export interface PromotionSync {
  id: string;
  name: string;
  kind: "PERCENT_OFF" | "AMOUNT_OFF" | "FIXED_PRICE" | "BUY_X_GET_Y";
  value: string;
  buy_quantity: string | null;
  get_quantity: string | null;
  min_quantity: string;
  targets: { type: string; id?: string | null }[];
  starts_at: string | null;
  ends_at: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  branch_ids: string[] | null;
  priority: number;
  is_active: boolean;
}

export interface PullTables {
  companies: CompanySync;
  branches: BranchSync;
  stock_locations: StockLocationSync;
  categories: CategorySync;
  brands: BrandSync;
  units: UnitSync;
  tax_rates: TaxRateSync;
  price_levels: PriceLevelSync;
  payment_methods: PaymentMethodSync;
  products: ProductSync;
  product_units: ProductUnitSync;
  product_variants: VariantSync;
  barcodes: BarcodeSync;
  prices: PriceSync;
  inventory_balances: InventoryBalanceSync;
  customers: CustomerSync;
  promotions: PromotionSync;
}

export type PullTableName = keyof PullTables;

/** Same order as backend TABLES (pull.py). */
export const PULL_TABLES: readonly PullTableName[] = [
  "companies",
  "branches",
  "stock_locations",
  "categories",
  "brands",
  "units",
  "tax_rates",
  "price_levels",
  "payment_methods",
  "products",
  "product_units",
  "product_variants",
  "barcodes",
  "prices",
  "inventory_balances",
  "customers",
  "promotions",
];

export interface StaffSync {
  id: string;
  username: string;
  full_name: string;
  is_active: boolean;
  can_use_pos: boolean;
  permissions: string[];
  pin_offline_salt: string | null;
  pin_offline_verifier: string | null;
  pin_offline_iterations: number | null;
  pin_updated_at: string | null;
}

export interface PullResponse {
  changes: Partial<{ [K in PullTableName]: PullTables[K][] }>;
  staff: StaffSync[] | null;
  counts: Partial<Record<PullTableName, number>> | null;
  next_cursor: string;
  has_more: boolean;
  server_time: string;
}

export interface SyncContext {
  device_id: string;
  terminal_code: string;
  company: CompanySync;
  branch: BranchSync;
  stock_locations: StockLocationSync[];
  default_stock_location_id: string;
  receipt_prefix: string;
  last_receipt_seq: number;
  /** BIR registration of this terminal. */
  device_bir?: DeviceBirSync;
  server_time: string;
}

export interface DeviceBirSync {
  min: string | null;
  serial_number: string | null;
  ptu_number: string | null;
  ptu_issued_on: string | null;
}

// --- Push ----------------------------------------------------------------------------------

export interface OperationIn {
  operation_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  created_at: string;
  payload: unknown;
}

export interface PushRequest {
  operations: OperationIn[];
  pending_count?: number;
  app_version?: string;
  device_time?: string;
}

export type OpStatus = "APPLIED" | "DUPLICATE" | "DEFERRED" | "REJECTED" | "CONFLICT" | "RETRY";

export interface OpError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OperationResult {
  operation_id: string;
  status: OpStatus;
  error: OpError | null;
  result: Record<string, unknown> | null;
}

export interface PushResponse {
  results: OperationResult[];
  server_time: string;
}

// --- Operation payloads ----------------------------------------------------------------------

export interface DiscountPayload {
  kind: "PERCENT" | "AMOUNT";
  value: string;
  reason: string | null;
  authorized_by_id: string | null;
}

export interface SaleItemPayload {
  id: string;
  line_no: number;
  variant_id: string;
  product_unit_id: string;
  unit_code: string;
  unit_factor: string;
  product_name: string;
  variant_name: string | null;
  sku: string;
  barcode: string | null;
  quantity: string;
  unit_price: string;
  original_unit_price: string | null;
  price_overridden_by_id: string | null;
  discount: DiscountPayload | null;
  promotion_id?: string | null;
  /** Senior citizen / PWD statutory discount on this line. */
  statutory: boolean;
  vat_exemption: string;
  statutory_discount: string;
  tax_rate_id: string | null;
  tax_rate: string;
  tax_kind: "VATABLE" | "EXEMPT" | "ZERO_RATED";
  gross: string;
  line_discount: string;
  order_discount_share: string;
  net: string;
  tax_amount: string;
  total: string;
}

export interface PaymentPayload {
  id: string;
  payment_method_id: string;
  amount: string;
  tendered: string | null;
  reference_no: string | null;
}

export interface SaleTotalsPayload {
  gross_total: string;
  line_discount_total: string;
  order_discount_total: string;
  discount_total: string;
  tax_total: string;
  total: string;
  paid_total: string;
  change_total: string;
  vatable_sales: string;
  vat_amount: string;
  exempt_sales: string;
  zero_rated_sales: string;
  vat_exemption_total: string;
  statutory_discount_total: string;
}

/** Senior citizen / PWD holder details (RA 9994 / RA 10754). */
export interface StatutoryDiscountPayload {
  kind: "SENIOR" | "PWD";
  id_number: string;
  holder_name: string;
  holder_tin: string | null;
}

export interface SaleCompletePayload {
  schema_version: 1;
  id: string;
  receipt_number: string;
  cash_session_id: string | null;
  cashier_id: string;
  customer_id: string | null;
  price_level_id: string;
  stock_location_id: string | null;
  prices_include_tax: boolean;
  occurred_at: string;
  order_discount: DiscountPayload | null;
  statutory_discount?: StatutoryDiscountPayload | null;
  notes: string | null;
  items: SaleItemPayload[];
  payments: PaymentPayload[];
  totals: SaleTotalsPayload;
}

export interface CashSessionOpenPayload {
  id: string;
  opened_by_id: string;
  opened_at: string;
  opening_float: string;
}

export interface CashSessionClosePayload {
  id: string;
  closed_by_id: string;
  closed_at: string;
  counted_cash: string;
  expected_cash: string;
  over_short: string;
  note: string | null;
}

export interface CashMovementPayload {
  id: string;
  cash_session_id: string;
  movement_type: "CASH_IN" | "CASH_OUT" | "PICKUP";
  amount: string;
  reason: string | null;
  user_id: string;
  authorized_by_id: string | null;
  occurred_at: string;
}

export interface CustomerUpsertPayload {
  id: string;
  user_id: string;
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  price_level_id: string | null;
  notes: string | null;
}

export interface SaleVoidPayload {
  id: string;
  voided_by_id: string;
  authorized_by_id: string | null;
  reason: string;
  occurred_at: string;
}

export interface ReturnItemPayload {
  id: string;
  sale_item_id: string;
  quantity: string;
  restock: boolean;
}

export interface RefundPayload {
  id: string;
  payment_method_id: string;
  amount: string;
  reference_no: string | null;
}

export interface ReturnCreatePayload {
  id: string;
  sale_id: string;
  return_number: string;
  cash_session_id: string | null;
  cashier_id: string;
  authorized_by_id: string | null;
  reason: string;
  occurred_at: string;
  items: ReturnItemPayload[];
  refunds: RefundPayload[];
}

// --- Online sale lookup (returns of other terminals' sales) ---------------------------------

export interface LookupSaleItem {
  id: string;
  line_no: number;
  variant_id: string;
  product_name: string;
  variant_name: string | null;
  sku: string;
  unit_code: string;
  quantity: string;
  base_quantity: string;
  unit_price: string;
  total: string;
}

export interface LookupSale {
  id: string;
  receipt_number: string;
  status: "COMPLETED" | "VOIDED";
  total: string;
  occurred_at: string;
  items: LookupSaleItem[];
}

export interface SaleLookupResponse {
  sale: LookupSale;
  returned_quantities: Record<string, string>;
  /** Amount already refunded per sale item (absent on older servers). */
  refunded_amounts?: Record<string, string>;
}
