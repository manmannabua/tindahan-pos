import { KeyRoundIcon } from "lucide-react";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Cashier sign-in" };

/**
 * Cashier PIN sign-in lives inside the terminal screen (/pos), because the cashier session is
 * memory-only and a page navigation would drop it. This route only points there.
 */
export default function PosLoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <KeyRoundIcon className="size-6 text-muted-foreground" />
      </span>
      <h1 className="text-xl font-semibold">Cashier sign-in</h1>
      <p className="text-sm text-muted-foreground">Cashiers sign in with their PIN on the terminal screen.</p>
      <a href="/pos" className="text-sm font-medium underline underline-offset-4">
        Open the terminal
      </a>
    </div>
  );
}
