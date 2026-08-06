import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useRegistrationAddons, type RegistrationRow } from "../lib/registrations";
import { PaymentStatusBadge } from "./StatusBadge";
import { RefundModal } from "./RefundModal";

const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export function RegistrationDetail({ row, onClose, onRefunded }: {
  row: RegistrationRow; onClose: () => void; onRefunded: () => void;
}) {
  const [refunding, setRefunding] = useState(false);
  const addons = useRegistrationAddons(row.id);
  const canRefund = row.payment_status === "paid";
  const customEntries = Object.entries(row.custom_data ?? {});

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-[420px] max-w-full flex-col gap-3.5 overflow-y-auto">
        <SheetHeader className="p-0">
          <SheetTitle className="text-lg font-bold">{row.full_name ?? "—"}</SheetTitle>
          {row.bib_name ? <div className="text-[13px] text-muted-foreground">{row.bib_name}</div> : null}
        </SheetHeader>

        <div className="grid gap-2.5">
          <Row label="Category" value={row.category_label ?? "—"} />
          <Row label="Amount" value={peso(row.total_amount)} />
          <Row label="Payment" value={<PaymentStatusBadge status={row.payment_status} />} />
          {row.payment_method ? <Row label="Method" value={row.payment_method} /> : null}
          <Row label="Registered" value={fmtDate(row.created_at)} />
        </div>

        {addons.data?.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add-ons</div>
            {addons.data.map((a, i) => <Row key={i} label={a.name ?? "—"} value={peso(a.price)} />)}
          </div>
        ) : null}

        {customEntries.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Registration fields</div>
            {customEntries.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          </div>
        ) : null}

        <div className="mt-auto flex justify-end">
          <Button
            variant={canRefund ? "destructive" : "secondary"}
            className="rounded-pill"
            disabled={!canRefund}
            onClick={() => setRefunding(true)}
          >
            {row.payment_status === "refunded" ? "Refunded" : "Refund"}
          </Button>
        </div>

        {refunding ? (
          <RefundModal
            registration={{ id: row.id, full_name: row.full_name, total_amount: row.total_amount }}
            onClose={() => setRefunding(false)}
            onDone={onRefunded}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
