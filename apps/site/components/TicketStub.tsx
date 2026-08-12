import { formatPeso } from "@race-pace/shared";

/** The ticket-stub summary that appears on register, pay, and the ticket —
 *  a forest panel with a dashed perforation and notched edges. */
export function TicketStub({ eventName, categoryLabel, meta, amountLabel, amount }: {
  eventName: string;
  categoryLabel: string;
  meta?: string;
  amountLabel: string;
  /** Null when the amount is not known YET and the sticker price would be the
   *  wrong number to show — a pass-on registration whose processing fee has not
   *  been priced. A dash is the honest placeholder; the caller explains it. */
  amount: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-forest">
      <div className="px-5 pt-5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[1.2px] text-[#7FE0A6]">{eventName}</p>
        <p className="mt-1 font-display text-[19px] font-extrabold tracking-[-0.3px] text-white">{categoryLabel}</p>
        {meta ? <p className="mt-1.5 text-[12px] text-white/70">{meta}</p> : null}
      </div>
      <div className="relative my-1 h-4">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/30" />
        <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <div className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
      </div>
      <div className="flex items-center justify-between px-5 pb-4">
        <span className="text-[10px] font-semibold uppercase tracking-[1px] text-white/60">{amountLabel}</span>
        <span className="text-[18px] font-bold tabular-nums text-white">
          {amount === null ? "—" : formatPeso(amount)}
        </span>
      </div>
    </div>
  );
}
