/**
 * Compile-time drift check between the hand-written types (types/api.ts) and the backend's
 * OpenAPI schema (types/openapi.d.ts, regenerated with `pnpm gen:api`).
 *
 * If the backend changes a response shape, `pnpm typecheck` fails here. Nothing in this file
 * runs at runtime.
 */
import type {
  AuditLog,
  Branch,
  BranchDetail,
  Company,
  Device,
  Me,
  Page,
  Permission,
  Role,
  SignupRequest,
  StockLocation,
  TokenResponse,
  User,
} from "./api";
import type { components } from "./openapi";

type S = components["schemas"];

/** Every field the frontend relies on must exist in the server type with a compatible type. */
type Covers<Server, Client> = Client extends Pick<Server, Extract<keyof Server, keyof Client>>
  ? Exclude<keyof Client, keyof Server> extends never
    ? true
    : { missingOnServer: Exclude<keyof Client, keyof Server> }
  : { incompatible: Client };

type Assert<T extends true> = T;

export type ContractChecks = [
  Assert<Covers<S["MeResponse"], Omit<Me, "branch_permissions">>>,
  Assert<Covers<S["TokenResponse"], Omit<TokenResponse, "user" | "token_type">>>,
  Assert<Covers<S["CompanyRead"], Company>>,
  Assert<Covers<S["BranchRead"], Branch>>,
  Assert<Covers<S["BranchDetail"], Omit<BranchDetail, "locations">>>,
  Assert<Covers<S["StockLocationRead"], StockLocation>>,
  Assert<Covers<S["UserRead"], Omit<User, "roles">>>,
  Assert<Covers<S["RoleRead"], Role>>,
  Assert<Covers<S["PermissionRead"], Permission>>,
  Assert<Covers<S["DeviceRead"], Device>>,
  Assert<Covers<S["AuditLogRead"], AuditLog>>,
  Assert<Covers<S["Page_UserRead_"], Omit<Page<User>, "items">>>,
  Assert<Covers<S["SignupRequest"], Required<SignupRequest>>>,
];
