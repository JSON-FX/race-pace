import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { listUnboundCheckoutReviews } from "@/lib/queries/unbound-checkouts";
import { listSingleCaptureReviews } from "@/lib/queries/single-capture-reviews";
import { Card } from "@/components/ui/card";
import { ReviewTable } from "./review-table";
import { CaptureReviewTable } from "./capture-review-table";

export default async function CheckoutReviewsPage() {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();

  const [reviews, captures] = await Promise.all([
    listUnboundCheckoutReviews(),
    listSingleCaptureReviews(),
  ]);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-[13px] flex flex-wrap items-center gap-2.5 rounded-xl bg-forest px-4 py-3 text-white">
        <ShieldCheck className="size-[17px] shrink-0" strokeWidth={1.9} aria-hidden />
        <b className="text-[13.5px] font-bold">Platform scope</b>
        <span className="text-[12px] font-semibold text-white/60">All organizations · super admin</span>
        <Badge variant="secondary" className="ms-auto px-2.5 py-[3px] tabular-nums">
          {reviews.length + captures.length} unresolved
        </Badge>
      </div>

      <h1 className="text-[21px] font-bold tracking-[-0.02em]">Checkout reviews</h1>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Review captured payments and pending PayMongo checkouts before releasing a place or closing a payout.
      </p>
      <Alert className="my-5 border-amber/30 bg-amber-tint/40 p-5">
        <ShieldAlert className="size-5 text-amber" aria-hidden />
        <AlertTitle className="font-semibold">Verify each checkout with PayMongo</AlertTitle>
        <AlertDescription className="mt-1 max-w-[75ch] text-sm leading-6">
          A missing session ID, missing capture, or passed deadline does not prove that PayMongo has no active or paid checkout.
          Escalate each case with its internal reference before releasing a place or closing a payout.
        </AlertDescription>
      </Alert>

      <h2 className="mb-2 mt-6 text-[15px] font-bold">Captured payments needing review ({captures.length})</h2>
      <Card className="gap-0 overflow-hidden border py-0">
        <CaptureReviewTable reviews={captures} />
      </Card>

      <h2 className="mb-2 mt-6 text-[15px] font-bold">Unbound checkout holds ({reviews.length})</h2>
      <Card className="gap-0 overflow-hidden border py-0">
        <ReviewTable reviews={reviews} />
      </Card>
    </div>
  );
}
