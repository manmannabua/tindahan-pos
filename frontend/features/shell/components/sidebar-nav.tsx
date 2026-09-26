"use client";

import { ExternalLinkIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { hasPermissionInAnyScope } from "@/lib/auth/permissions";
import { featureForRoute, isFeatureOn } from "@/lib/features";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

import { activeHref, NAV_ITEMS, NAV_SECTIONS } from "../nav-items";

/**
 * Sidebar: branding pinned to the top, the POS launcher pinned to the bottom, and only the
 * navigation in between scrolls (its scrollbar appears on hover).
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const items = NAV_ITEMS.filter((item) => {
    const feature = featureForRoute(item.href);
    return (
      (!item.permission || hasPermissionInAnyScope(user, item.permission)) &&
      (!feature || isFeatureOn(user?.company.features, feature))
    );
  });
  const active = activeHref(pathname, items);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-5 font-semibold">
        <Image src="/brand/pos-symbol.png" alt="" width={32} height={32}
          unoptimized className="size-8 shrink-0 rounded-lg" />
        <span className="truncate">{user?.company.name ?? "POS"}</span>
      </div>

      <nav className="scrollbar-on-hover min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
        {NAV_SECTIONS.map((section) => {
          const sectionItems = items.filter((i) => i.section === section);
          if (sectionItems.length === 0) return null;
          return (
            <div key={section} className="mb-2">
              <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">{section}</p>
              {sectionItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active === href ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active === href && "bg-muted text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t p-3">
        {/* Plain anchor: the POS is a separate, offline-capable app shell. */}
        <a
          href="/pos"
          className="flex h-10 items-center gap-3 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
        >
          <ExternalLinkIcon className="size-4" />
          Open POS terminal
        </a>
      </div>
    </div>
  );
}
