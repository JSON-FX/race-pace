"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { TableEmptyState } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, peso } from "@/lib/format";
import type { UnboundCheckoutReview } from "@/lib/queries/unbound-checkouts";

function byDeadline(a: UnboundCheckoutReview, b: UnboundCheckoutReview, newestFirst: boolean): number {
  if (!a.expires_at) return b.expires_at ? 1 : 0;
  if (!b.expires_at) return -1;
  const result = a.expires_at.localeCompare(b.expires_at);
  return newestFirst ? -result : result;
}

export function ReviewTable({ reviews }: { reviews: UnboundCheckoutReview[] }) {
  const [newestFirst, setNewestFirst] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const rows = [...reviews].sort((a, b) => byDeadline(a, b, newestFirst));

  if (reviews.length === 0) {
    return <TableEmptyState title="No unresolved checkout reviews" description="No pending PayMongo checkout currently lacks a saved provider session." />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-3">
        <b className="text-[13px]">Unresolved holds</b>
        <Button size="sm" variant="outline" onClick={() => setNewestFirst((value) => !value)}>
          Hold deadline: {newestFirst ? "newest first" : "oldest first"}
        </Button>
      </div>
      <Table className="text-[12.5px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Event / organization</TableHead>
            <TableHead>Internal reference</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Hold deadline</TableHead>
            <TableHead>Expiry review</TableHead>
            <TableHead>Capture evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.registration_id}>
              <TableCell className="py-2.5">
                <div className="font-semibold">{row.event_name}</div>
                <div className="text-[11px] text-muted-foreground">{row.org_name}</div>
              </TableCell>
              <TableCell className="py-2.5">
                <div className="flex items-center gap-2">
                  <code className="break-all text-[11px]">{row.registration_id}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Copy registration reference ${row.registration_id}`}
                    title={copied === row.registration_id ? "Copied" : "Copy reference"}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(row.registration_id);
                        setCopied(row.registration_id);
                      } catch {
                        setCopied(null);
                      }
                    }}
                  >
                    <Copy aria-hidden />
                  </Button>
                </div>
              </TableCell>
              <TableCell className="py-2.5 text-right tabular-nums">{peso(row.amount_cents)}</TableCell>
              <TableCell className="py-2.5 tabular-nums">
                {row.expires_at ? fmtDateTime(row.expires_at) : "Unknown"}
              </TableCell>
              <TableCell className="py-2.5">
                <div>{row.latest_outcome ? row.latest_outcome.replaceAll("_", " ") : "Not attempted"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                  {row.last_attempt_at ? ` · last ${fmtDateTime(row.last_attempt_at)}` : ""}
                </div>
              </TableCell>
              <TableCell className="py-2.5">
                {row.capture_count > 0
                  ? `${row.capture_count} provider capture${row.capture_count === 1 ? "" : "s"} recorded; review required`
                  : "No local capture recorded"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
