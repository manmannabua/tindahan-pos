/**
 * Admin-portal types for Phases 2–9, taken directly from the generated OpenAPI schema
 * (`pnpm gen:api` → types/openapi.d.ts) so they cannot drift from the backend.
 *
 * Decimals arrive as strings; request bodies send decimal strings too (never JS floats).
 */
import type { components } from "./openapi";

type S = components["schemas"];

// Catalog
export type Category = S["CategoryRead"];
export type CategoryCreate = S["CategoryCreate"];
export type CategoryUpdate = S["CategoryUpdate"];
export type Brand = S["BrandRead"];
export type Unit = S["UnitRead"];
export type TaxRate = S["TaxRateRead"];
export type PriceLevel = S["PriceLevelRead"];
export type PaymentMethod = S["PaymentMethodRead"];
export type ProductSummary = S["ProductSummary"];
export type Product = S["ProductRead"];
export type ProductCreate = S["ProductCreate"];
export type ProductUpdate = S["ProductUpdate"];
export type ProductUnit = S["ProductUnitRead"];
export type Variant = S["VariantRead"];
export type VariantIn = S["VariantIn"];
export type VariantUpdate = S["VariantUpdate"];
export type Barcode = S["BarcodeRead"];
export type Price = S["PriceRead"];
export type PriceIn = S["PriceIn"];
export type BarcodeLookup = S["BarcodeLookup"];

// Inventory
export type Balance = S["BalanceRead"];
export type Movement = S["MovementRead"];
export type Adjustment = S["AdjustmentRead"];
export type AdjustmentCreate = S["AdjustmentCreate"];
export type StockCount = S["CountRead"];
export type StockCountLine = S["CountLineRead"];
export type Transfer = S["TransferRead"];
export type TransferCreate = S["TransferCreate"];
export type PostingResult = S["PostingResultRead"];

// Purchasing
export type Supplier = S["SupplierRead"];
export type SupplierCreate = S["SupplierCreate"];
export type SupplierUpdate = S["SupplierUpdate"];
export type PurchaseOrder = S["PORead"];
export type POCreate = S["POCreate"];
export type GoodsReceipt = S["ReceiptRead"];
export type ReceiptCreate = S["ReceiptCreate"];

// Sales, customers, promotions
export type SaleSummary = S["SaleSummary"];
export type SaleDetail = S["SaleDetail"];
export type SaleReturn = S["ReturnRead"];
export type ReturnCreate = S["ReturnCreate"];
export type Customer = S["CustomerRead"];
export type CustomerCreate = S["CustomerCreate"];
export type CustomerUpdate = S["CustomerUpdate"];
export type Promotion = S["PromotionRead"];
export type PromotionCreate = S["PromotionCreate"];
export type PromotionKind = Promotion["kind"];

// Management
export type Expense = S["ExpenseRead"];
export type ExpenseCreate = S["ExpenseCreate"];
export type ExpenseCategory = S["ExpenseCategoryRead"];
export type ReportInfo = S["ReportInfo"];
export type ReportResult = S["ReportResult"];
export type ReportExport = S["ExportRead"];
export type Dashboard = S["DashboardResponse"];
export type ReviewFlag = S["ReviewFlagRead"];
export type SyncMonitor = S["SyncMonitorResponse"];
export type MonitoredDevice = S["MonitoredDevice"];
export type FailedOperation = S["FailedOperation"];
export type ImportJob = S["ImportJobRead"];

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
