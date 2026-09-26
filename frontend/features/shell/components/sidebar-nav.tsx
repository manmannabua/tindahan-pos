"use client";

import { ExternalLinkIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { hasPermissionInAnyScope } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

import { activeHref, NAV_ITEMS, NAV_SECTIONS } from "../nav-items";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const items = NAV_ITEMS.filter((item) => !item.permission || hasPermissionInAnyScope(user, item.permission));
  const active = activeHref(pathname, items);

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3" aria-label="Main">
      <div className="mb-3 flex items-center gap-2 px-2 pt-1 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ReceiptTextIcon className="size-4" />
        </span>
        <span className="truncate">{user?.company.name ?? "POS"}</span>
      </div>
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
      <div className="mt-auto pt-4">
        {/* Plain anchor: the POS is a separate, offline-capable app shell. */}
        <a
          href="/pos"
          className="flex h-10 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted"
        >
          <ExternalLinkIcon className="size-4" />
          Open POS terminal
        </a>
      </div>
    </nav>
  );
}
