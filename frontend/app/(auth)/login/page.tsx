import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";
import { RedirectIfAuthenticated } from "@/features/auth/components/redirect-if-authenticated";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <RedirectIfAuthenticated>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>Manage products, stock, staff and terminals.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* useSearchParams (for ?next=) requires a Suspense boundary on static pages. */}
          <Suspense>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </RedirectIfAuthenticated>
  );
}
