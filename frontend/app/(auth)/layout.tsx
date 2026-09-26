import Image from "next/image";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Image src="/brand/pos-logo.png" alt="POS" width={160} height={49}
            unoptimized className="h-auto w-40 rounded-lg bg-white p-2" />
        </div>
        {children}
      </div>
    </main>
  );
}
