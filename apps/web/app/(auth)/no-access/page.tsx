import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/lib/actions/auth";

export default function NoAccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm rounded-xl text-center">
        <CardHeader>
          <CardTitle className="text-xl">No admin access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This account isn&apos;t an organizer on any event. Ask your organization
            admin to invite you, then sign in again.
          </p>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" className="w-full">Sign out</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
