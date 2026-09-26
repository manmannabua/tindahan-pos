import { StoreIcon } from "lucide-react";

export default function StoreNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <StoreIcon className="text-muted-foreground size-10" aria-hidden />
      <h1 className="text-xl font-semibold">Store not found</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        This online catalog doesn&apos;t exist or isn&apos;t available right now. Check the link or ask the store.
      </p>
    </main>
  );
}
