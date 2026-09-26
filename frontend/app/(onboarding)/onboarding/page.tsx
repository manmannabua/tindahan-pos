"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useRestoreSession } from "@/features/auth/use-restore-session";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";
import { useAuthStore } from "@/stores/auth-store";

/** First-run setup. Signed-in owners of a business that hasn't finished onboarding land here. */
export default function OnboardingPage() {
  const status = useRestoreSession();
  const router = useRouter();
  const completed = useAuthStore((s) => s.user?.company.onboarding_completed);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login?next=/onboarding");
    else if (status === "authenticated" && completed) router.replace("/dashboard");
  }, [status, completed, router]);

  if (status !== "authenticated" || completed) {
    return (
      <div className="flex min-h-svh flex-1 items-center justify-center" aria-busy="true">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  return (
    <main className="min-h-svh flex-1 bg-muted/40">
      <OnboardingWizard />
    </main>
  );
}
