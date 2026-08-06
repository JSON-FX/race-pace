import { Suspense } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm rounded-xl">
        <CardHeader className="items-center text-center">
          <Image src="/topnav-logo.png" alt="" width={40} height={40} priority />
          <CardTitle className="text-xl">Race Pace Admin</CardTitle>
        </CardHeader>
        <CardContent>
          {/* useSearchParams needs a Suspense boundary or the whole route
              opts out of static rendering with a build-time warning. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
