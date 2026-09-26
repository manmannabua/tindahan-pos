"use client";

import { Loader2Icon, MenuIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { FeatureOff } from "@/components/shared/feature-off";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useRestoreSession } from "@/features/auth/use-restore-session";
import { hasPermission, PERM } from "@/lib/auth/permissions";
import { featureForRoute, isFeatureOn } from "@/lib/features";
import { useAuthStore } from "@/stores/auth-store";

import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

/** Authenticated layout for the admin portal (online-only by design). */
export function AdminShell({ children }: { children: ReactNode }) {
  const status = useRestoreSession();
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const companyName = user?.company.name;
  const canManageCompany = hasPermission(user, PERM.COMPANY_MANAGE);
  // A new business: the owner sets it up first (staff can use the portal meanwhile).
  const needsOnboarding = Boolean(user && !user.company.onboarding_completed && canManageCompany);
  const routeFeature = featureForRoute(pathname);
  const featureOff = routeFeature !== null && !isFeatureOn(user?.company.features, routeFeature);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === "authenticated" && needsOnboarding) router.replace("/onboarding");
  }, [status, router, pathname, needsOnboarding]);

  if (status !== "authenticated" || needsOnboarding) {
    return (
      <div className="flex min-h-svh flex-1 items-center justify-center" aria-busy="true">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-1">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r bg-sidebar lg:block print:hidden">
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur print:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon-lg" className="lg:hidden" aria-label="Open menu" />}>
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="truncate text-sm font-medium text-muted-foreground lg:hidden">{companyName}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 print:m-0 print:max-w-none print:p-0">
          {featureOff && routeFeature ? <FeatureOff feature={routeFeature} canManage={canManageCompany} /> : children}
        </main>
      </div>
    </div>
  );
}
