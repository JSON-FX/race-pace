import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
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
        <span className="ms-auto rounded-pill bg-white/15 px-2.5 py-[3px] text-[11px] font-bold tabular-nums">
          {reviews.length + captures.length} unresolved
        </span>
      </div>

      <h1 className="text-[21px] font-bold tracking-[-0.02em]">Checkout reviews</h1>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Review captured payments and pending PayMongo checkouts before releasing a place or closing a payout.
      </p>
      <p className="my-4 rounded-[9px] border border-l-[3px] border-l-amber bg-card px-3.5 py-[11px] text-[13px] leading-[1.55]">
        <b>Provider verification required.</b> A missing session ID, missing capture, or passed deadline does not prove
        that PayMongo has no active or paid checkout. Escalate each case with its internal reference.
      </p>

      <h2 className="mb-2 mt-6 text-[15px] font-bold">Captured payments needing review ({captures.length})</h2>
      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <CaptureReviewTable reviews={captures} />
      </Card>

      <h2 className="mb-2 mt-6 text-[15px] font-bold">Unbound checkout holds ({reviews.length})</h2>
      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <ReviewTable reviews={reviews} />
      </Card>
    </div>
  );
}
