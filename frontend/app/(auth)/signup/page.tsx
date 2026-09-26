import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RedirectIfAuthenticated } from "@/features/auth/components/redirect-if-authenticated";
import { SignupForm } from "@/features/auth/components/signup-form";

export const metadata: Metadata = { title: "Create your business" };

export default function SignupPage() {
  return (
    <RedirectIfAuthenticated>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Create your business</h1>
          </CardTitle>
          <CardDescription>
            Sets up your company, a main branch with its store location, and your owner account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </RedirectIfAuthenticated>
  );
}
