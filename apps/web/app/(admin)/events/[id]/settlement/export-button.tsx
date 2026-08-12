"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { settlementCsv, type SettlementRow } from "@/lib/settlement-csv";

/** Serialises client-side from rows the page already rendered, so the export
 *  and the table can never disagree — no second query, no second read model.
 *
 *  Imports `@/lib/settlement-csv` directly and NEVER `@/lib/queries/settlement`,
 *  which reaches `next/headers` through the Supabase server client. That is a
 *  build error in a Client Component, not a bundle-size regression — the whole
 *  reason the arithmetic lives in `@/lib/settlement-math` rather than beside the
 *  query. */
export function ExportSettlementButton({
  rows, eventName,
}: { rows: SettlementRow[]; eventName: string }) {
  function download() {
    const blob = new Blob([settlementCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${eventName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-settlement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button size="sm" variant="outline" className="rounded-pill" onClick={download}>
      <Download className="size-4" strokeWidth={1.9} aria-hidden />
      Export CSV
    </Button>
  );
}
