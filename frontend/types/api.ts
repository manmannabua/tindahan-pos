/**
 * Hand-written types mirroring the backend Pydantic schemas (backend/app/modules/* /schemas.py).
 *
 * `pnpm gen:api` generates `types/openapi.d.ts` from the live OpenAPI document; use it to check
 * these types for drift. UUIDs and datetimes are strings; money/decimals are decimal strings.
 */

export type UUID = string;
export type ISODateTime = string;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// --- Auth ----------------------------------------------------------------------------------

export type AuthClient = "admin" | "pos";

export interface CompanySummary {
  id: UUID;
  code: string;
  name: string;
  currency: string;
  timezone: string;
  prices_include_tax: boolean;
}

export interface Me {
  id: UUID;
  email: string;
  username: string;
  full_name: string;
  has_pin: boolean;
  company: CompanySummary;
  device_id: UUID | null;
  /** Permissions granted company-wide. */
  permissions: string[];
  /** Permissions granted only for specific branches, keyed by branch id. */
  branch_permissions: Record<UUID, string[]>;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: Me;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

// --- Companies -----------------------------------------------------------------------------

export interface SignupRequest {
  company_name: string;
  company_code: string;
  branch_name?: string;
  branch_code?: string;
  owner_full_name: string;
  owner_email: string;
  owner_username: string;
  owner_password: string;
  timezone?: string;
  currency?: string;
}

export interface Company {
  id: UUID;
  code: string;
  name: string;
  legal_name: string | null;
  tin: string | null;
  currency: string;
  timezone: string;
  prices_include_tax: boolean;
  settings: Record<string, unknown>;
  is_active: boolean;
}

export interface SignupResponse {
  company: Company;
  owner_user_id: UUID;
  branch_id: UUID;
}

export interface CompanyUpdate {
  name?: string;
  legal_name?: string | null;
  tin?: string | null;
  timezone?: string;
  prices_include_tax?: boolean;
  settings?: Record<string, unknown>;
}

// --- Branches ------------------------------------------------------------------------------

export type LocationType = "STORE" | "BACKROOM" | "WAREHOUSE";

export interface StockLocation {
  id: UUID;
  branch_id: UUID;
  code: string;
  name: string;
  location_type: LocationType;
  is_default: boolean;
  is_active: boolean;
}

export interface Branch {
  id: UUID;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  tin: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  is_active: boolean;
}

export interface BranchDetail extends Branch {
  locations: StockLocation[];
}

export interface BranchCreate {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  tin?: string | null;
  receipt_header?: string | null;
  receipt_footer?: string | null;
}

export type BranchUpdate = Partial<Omit<BranchCreate, "code">> & { is_active?: boolean };

export interface StockLocationCreate {
  code: string;
  name: string;
  location_type: LocationType;
  is_default: boolean;
}

export interface StockLocationUpdate {
  name?: string;
  location_type?: LocationType;
  is_default?: boolean;
  is_active?: boolean;
}

// --- Users & roles -------------------------------------------------------------------------

export interface RoleAssignment {
  role_id: UUID;
  branch_id: UUID | null;
}

export interface RoleAssignmentRead extends RoleAssignment {
  role_code: string;
  role_name: string;
}

export interface User {
  id: UUID;
  email: string;
  username: string;
  full_name: string;
  is_active: boolean;
  has_pin: boolean;
  last_login_at: ISODateTime | null;
  created_at: ISODateTime;
  roles: RoleAssignmentRead[];
}

export interface UserCreate {
  email: string;
  username: string;
  full_name: string;
  password: string;
  pin?: string;
  roles: RoleAssignment[];
}

export interface UserUpdate {
  email?: string;
  full_name?: string;
  is_active?: boolean;
}

export interface Role {
  id: UUID;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
}

export interface RoleCreate {
  code: string;
  name: string;
  description?: string | null;
  permissions: string[];
}

export interface RoleUpdate {
  name?: string;
  description?: string | null;
  permissions?: string[];
}

export interface Permission {
  code: string;
  description: string;
}

// --- Devices -------------------------------------------------------------------------------

export type DeviceStatus = "ACTIVE" | "REVOKED";

export interface Device {
  id: UUID;
  branch_id: UUID;
  terminal_code: string;
  name: string;
  platform: string | null;
  app_version: string | null;
  status: DeviceStatus;
  registered_at: ISODateTime;
  registered_by_id: UUID;
  revoked_at: ISODateTime | null;
  last_seen_at: ISODateTime | null;
  last_sync_at: ISODateTime | null;
  pending_operations: number | null;
}

// --- Audit ---------------------------------------------------------------------------------

export interface AuditLog {
  id: UUID;
  branch_id: UUID | null;
  user_id: UUID | null;
  device_id: UUID | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  ip_address: string | null;
  occurred_at: ISODateTime;
}

export interface AuditLogPage {
  items: AuditLog[];
  next_cursor: string | null;
}

// --- Health --------------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  server_time: ISODateTime;
}
