import {
  ArrowLeftRightIcon,
  BarChart3Icon,
  BoxesIcon,
  Building2Icon,
  ClipboardCheckIcon,
  ContactIcon,
  FlagIcon,
  GlobeIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MonitorSmartphoneIcon,
  PackageIcon,
  PercentIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  TagsIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import { PERM } from "@/lib/auth/permissions";

import { ADMIN_PERM } from "./permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only if the user holds this permission in any scope (UI gating; server enforces). */
  permission?: string;
  section: NavSection;
}

export type NavSection = "Overview" | "Sales" | "Catalog" | "Inventory" | "Purchasing" | "Management" | "Administration";

export const NAV_SECTIONS: NavSection[] = [
  "Overview",
  "Sales",
  "Catalog",
  "Inventory",
  "Purchasing",
  "Management",
  "Administration",
];

export const NAV_ITEMS: NavItem[] = [
  { section: "Overview", href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { section: "Overview", href: "/reports", label: "Reports", icon: BarChart3Icon, permission: ADMIN_PERM.REPORTS_VIEW },

  { section: "Sales", href: "/sales", label: "Sales", icon: ReceiptTextIcon, permission: ADMIN_PERM.SALES_VIEW },
  { section: "Sales", href: "/receipts", label: "Receipts", icon: ReceiptIcon, permission: ADMIN_PERM.SALES_VIEW },
  { section: "Sales", href: "/customers", label: "Customers", icon: ContactIcon, permission: ADMIN_PERM.CUSTOMERS_READ },
  { section: "Sales", href: "/promotions", label: "Promotions", icon: PercentIcon, permission: ADMIN_PERM.PRODUCTS_READ },

  { section: "Catalog", href: "/products", label: "Products", icon: PackageIcon, permission: ADMIN_PERM.PRODUCTS_READ },
  { section: "Catalog", href: "/catalog", label: "Catalog setup", icon: TagsIcon, permission: ADMIN_PERM.PRODUCTS_READ },
  { section: "Catalog", href: "/online-catalog", label: "Online catalog", icon: GlobeIcon, permission: PERM.COMPANY_MANAGE },

  { section: "Inventory", href: "/inventory", label: "Stock", icon: BoxesIcon, permission: ADMIN_PERM.INVENTORY_READ },
  { section: "Inventory", href: "/inventory/counts", label: "Stock counts", icon: ClipboardCheckIcon, permission: ADMIN_PERM.INVENTORY_READ },
  { section: "Inventory", href: "/inventory/transfers", label: "Transfers", icon: ArrowLeftRightIcon, permission: ADMIN_PERM.INVENTORY_READ },

  { section: "Purchasing", href: "/purchase-orders", label: "Purchase orders", icon: ShoppingCartIcon, permission: ADMIN_PERM.PURCHASING_RECEIVE },
  { section: "Purchasing", href: "/suppliers", label: "Suppliers", icon: TruckIcon, permission: ADMIN_PERM.PURCHASING_RECEIVE },

  { section: "Management", href: "/expenses", label: "Expenses", icon: WalletIcon, permission: ADMIN_PERM.EXPENSES_MANAGE },
  { section: "Management", href: "/review-flags", label: "Review flags", icon: FlagIcon, permission: ADMIN_PERM.REVIEW_FLAGS_MANAGE },
  { section: "Management", href: "/sync-monitor", label: "Sync monitor", icon: RefreshCwIcon, permission: ADMIN_PERM.SYNC_MONITOR },

  { section: "Administration", href: "/branches", label: "Branches", icon: Building2Icon },
  { section: "Administration", href: "/users", label: "Users", icon: UsersIcon, permission: PERM.USERS_MANAGE },
  { section: "Administration", href: "/roles", label: "Roles", icon: ShieldCheckIcon, permission: PERM.ROLES_MANAGE },
  { section: "Administration", href: "/devices", label: "Devices", icon: MonitorSmartphoneIcon, permission: PERM.DEVICES_MANAGE },
  { section: "Administration", href: "/audit", label: "Audit log", icon: HistoryIcon, permission: PERM.AUDIT_VIEW },
  { section: "Administration", href: "/settings/company", label: "Company", icon: SettingsIcon, permission: PERM.COMPANY_MANAGE },
];

/** The most specific nav item matching the path (so /inventory/counts doesn't also light /inventory). */
export function activeHref(pathname: string, items: NavItem[]): string | null {
  const matches = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}
