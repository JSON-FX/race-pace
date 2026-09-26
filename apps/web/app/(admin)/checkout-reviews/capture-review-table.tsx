import { TableEmptyState } from "@/components/data-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, peso } from "@/lib/format";
import type { SingleCaptureReview } from "@/lib/queries/single-capture-reviews";

export function CaptureReviewTable({ reviews }: { reviews: SingleCaptureReview[] }) {
  if (reviews.length === 0) {
    return <TableEmptyState title="No captured payments need review" description="PayMongo captures that require reconciliation appear here." />;
  }

  return (
    <Table className="text-[12.5px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Event / organization</TableHead>
          <TableHead>Payment / registration reference</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Captured</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((row) => (
          <TableRow key={row.provider_payment_id}>
            <TableCell className="py-2.5">
              <div className="font-semibold">{row.event_name}</div>
              <div className="text-[11px] text-muted-foreground">{row.org_name}</div>
            </TableCell>
            <TableCell className="py-2.5">
              <code className="block break-all text-[11px]">{row.provider_payment_id}</code>
              <code className="block break-all text-[11px] text-muted-foreground">{row.registration_id}</code>
            </TableCell>
            <TableCell className="py-2.5">
              <div>{row.reason?.replaceAll("_", " ") ?? "Needs review"}</div>
              <div className="text-[11px] text-muted-foreground">
                Registration: {row.registration_status} · Payment: {row.payment_status}
              </div>
            </TableCell>
            <TableCell className="py-2.5 tabular-nums">{fmtDateTime(row.first_seen_at)}</TableCell>
            <TableCell className="py-2.5 text-right tabular-nums">
              {row.amount_cents === null ? "Unknown" : peso(row.amount_cents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
