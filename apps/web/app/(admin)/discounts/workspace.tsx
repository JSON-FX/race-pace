"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Plus, Check, TicketPercent, X } from "lucide-react";
import { discountUnits } from "@race-pace/shared";
import {
  createDiscounts,
  setDiscountActive,
  searchDiscountPassports,
  type DiscountPassportOption,
} from "@/lib/actions/discounts";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { peso } from "@/lib/format";
export type DiscountRecord = {
  id: string;
  code: string;
  kind: "regular" | "special";
  discount_type: "percent" | "flat";
  value: number;
  coverage: "entry" | "subtotal";
  scope: string;
  max_uses: number | null;
  reserved: number;
  redeemed: number;
  active: boolean;
  absorb_fees: boolean;
  assigned_passport_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
};
type Props = {
  codes: DiscountRecord[];
  events: { id: string; name: string }[];
  categories: { id: string; label: string; event_id: string }[];
  passports: DiscountPassportOption[];
};
const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function DiscountsWorkspace({
  codes,
  events,
  categories,
  passports,
}: Props) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState("regular"),
    [type, setType] = useState("percent"),
    [scope, setScope] = useState("organization");
  const [coverage, setCoverage] = useState("entry");
  const [value, setValue] = useState("20"),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [copied, setCopied] = useState<string | null>(null);
  const [passportSearch, setPassportSearch] = useState(""),
    [passportOptions, setPassportOptions] = useState(passports),
    [assigned, setAssigned] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      searchDiscountPassports(passportSearch)
        .then((rows) => {
          if (!cancelled) setPassportOptions(rows);
        })
        .catch(() => {
          if (!cancelled)
            setError("Passport search is unavailable. Please try again.");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [passportSearch]);
  const free = type === "percent" && discountUnits(value) === 10000;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError(null);
    setFeedback(null);
    const units = discountUnits(value);
    if (units === null) {
      setError("Enter an amount with up to two decimal places.");
      setBusy(false);
      return;
    }
    const time = (name: string) =>
      data.get(name) ? `${data.get(name)}:00+08:00` : null;
    try {
      const result = await createDiscounts({
        kind,
        code: String(data.get("code") ?? ""),
        discount_type: type,
        value: units,
        coverage: free ? "subtotal" : data.get("coverage"),
        scope,
        event_ids: scope === "events" ? data.getAll("eligible") : [],
        category_ids: scope === "categories" ? data.getAll("eligible") : [],
        quantity: kind === "special" ? Number(data.get("quantity")) : 1,
        max_uses:
          kind === "regular" && data.get("max_uses")
            ? Number(data.get("max_uses"))
            : null,
        absorb_fees: kind === "special" && data.get("absorb_fees") === "on",
        passport_ids: kind === "special" ? data.getAll("passports") : [],
        starts_at: time("starts_at"),
        ends_at: time("ends_at"),
      });
      setBusy(false);
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        setFeedback(
          `${result.created} discount code${result.created === 1 ? "" : "s"} created. Copy or export to share.`,
        );
      }
    } catch {
      setError("Could not create codes. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(code: DiscountRecord) {
    setBusy(true);
    setError(null);
    try {
      const r = await setDiscountActive(code.id, !code.active);
      if (r.error) setError(r.error);
    } catch {
      setError("Could not update this code. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Regular codes share a use limit. Special codes each belong to one
          redemption.
        </p>
        <Button
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
          aria-expanded={open}
        >
          <Plus className="mr-2 size-4" />
          Create discount
        </Button>
      </div>
      {feedback && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-accent p-4 text-sm text-accent-foreground"
        >
          {feedback}
        </p>
      )}
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {open && (
        <form
          onSubmit={submit}
          className="mb-8 rounded-2xl border bg-card p-5 sm:p-6"
        >
          <h2 className="mb-5 text-lg font-semibold">Create discount</h2>
          <fieldset disabled={busy} className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="discount-kind">Code type</Label>
              <NativeSelect
                id="discount-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className={selectClass}
              >
                <NativeSelectOption value="regular">
                  Regular · shared code
                </NativeSelectOption>
                <NativeSelectOption value="special">
                  Special · unique codes
                </NativeSelectOption>
              </NativeSelect>
            </div>
            {kind === "regular" ? (
              <div className="space-y-2">
                <Label htmlFor="discount-code">Code</Label>
                <Input
                  id="discount-code"
                  name="code"
                  placeholder="TRAIL20"
                  required
                  minLength={4}
                  maxLength={40}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{3,39}"
                  className="h-11 font-mono uppercase"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="quantity">Number of unique codes</Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min={1}
                  max={500}
                  defaultValue={1}
                  required
                  className="h-11"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="discount-type">Discount</Label>
              <div className="flex flex-col gap-2 xl:flex-row">
                <NativeSelect
                  id="discount-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className={selectClass}
                >
                  <NativeSelectOption value="percent">
                    Percentage off
                  </NativeSelectOption>
                  <NativeSelectOption value="flat">
                    Pesos off
                  </NativeSelectOption>
                </NativeSelect>
                <Input
                  aria-label={type === "percent" ? "Percentage" : "Pesos"}
                  inputMode="decimal"
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-11 xl:max-w-32"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coverage">Applies to</Label>
              <NativeSelect
                id="coverage"
                name="coverage"
                className={selectClass}
                disabled={free}
                value={free ? "subtotal" : coverage}
                onChange={(e) => setCoverage(e.target.value)}
              >
                <NativeSelectOption value="entry">
                  Entry fee only
                </NativeSelectOption>
                <NativeSelectOption value="subtotal">
                  Entry, add-ons, and delivery
                </NativeSelectOption>
              </NativeSelect>
              {free && (
                <p className="text-sm text-primary">
                  100% covers everything. The runner pays nothing, including
                  fees.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="scope">Eligible races</Label>
              <NativeSelect
                id="scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className={selectClass}
              >
                <NativeSelectOption value="organization">
                  All organization events
                </NativeSelectOption>
                <NativeSelectOption value="events">
                  Selected events
                </NativeSelectOption>
                <NativeSelectOption value="categories">
                  Selected categories
                </NativeSelectOption>
              </NativeSelect>
            </div>
            {kind === "regular" ? (
              <div className="space-y-2">
                <Label htmlFor="max-uses">
                  Participant limit{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="max-uses"
                  name="max_uses"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Each Passport can redeem this code once.
                </p>
              </div>
            ) : (
              <label className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm">
                <Checkbox className="mt-1 size-4" name="absorb_fees" />
                <span>
                  <strong className="block font-medium">
                    Organizer absorbs all fees
                  </strong>
                  <span className="text-muted-foreground">
                    Race Pace and PayMongo fees come out of organizer proceeds.
                  </span>
                </span>
              </label>
            )}
            {scope !== "organization" && (
              <fieldset className="md:col-span-2">
                <legend className="mb-2 text-sm font-medium">
                  Choose {scope}
                </legend>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                  {(scope === "events"
                    ? events.map((e) => ({ id: e.id, label: e.name }))
                    : categories.map((c) => ({
                        id: c.id,
                        label: `${events.find((e) => e.id === c.event_id)?.name ?? "Event"} · ${c.label}`,
                      }))
                  ).map((o) => (
                    <label
                      key={o.id}
                      className="flex min-h-11 items-center gap-3 text-sm"
                    >
                      <Checkbox
                        name="eligible"
                        value={o.id}
                        className="size-4"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="space-y-2">
              <Label htmlFor="starts-at">
                Starts{" "}
                <span className="font-normal text-muted-foreground">
                  (optional, Manila)
                </span>
              </Label>
              <Input
                id="starts-at"
                name="starts_at"
                type="datetime-local"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ends-at">
                Ends{" "}
                <span className="font-normal text-muted-foreground">
                  (optional, Manila)
                </span>
              </Label>
              <Input
                id="ends-at"
                name="ends_at"
                type="datetime-local"
                className="h-11"
              />
            </div>
            {kind === "special" && (
              <Collapsible className="md:col-span-2">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 px-0"
                  >
                    Assign codes to Passports (optional)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Find any registered runner by name or email, even before they
                    join your events. Select one Passport per code. Leave empty to let the first
                    eligible runner redeem each code.
                  </p>
                  <Input
                    aria-label="Search runners by name, email or Passport ID"
                    placeholder="Search by name, email or Passport ID"
                    value={passportSearch}
                    onChange={(e) => setPassportSearch(e.target.value)}
                    className="mb-3 h-11"
                  />
                  <p className="mb-2 text-xs text-muted-foreground">
                    Showing up to 50 matches. {Object.keys(assigned).length}{" "}
                    selected.
                  </p>
                  {Object.entries(assigned).map(([id, label]) => (
                    <span
                      key={id}
                      className="mb-2 mr-2 inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-sm"
                    >
                      <input type="hidden" name="passports" value={id} />
                      <span className="min-w-0 break-words">{label}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11"
                        aria-label={`Unassign ${label}`}
                        onClick={() =>
                          setAssigned((current) => {
                            const next = { ...current };
                            delete next[id];
                            return next;
                          })
                        }
                      >
                        <X aria-hidden="true" className="size-4" />
                      </Button>
                    </span>
                  ))}
                  <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                    {passportOptions.length ? (
                      passportOptions.map((p) => (
                        <label
                          key={p.id}
                          className="flex min-h-11 min-w-0 items-center gap-3 text-sm"
                        >
                          <Checkbox
                            checked={!!assigned[p.id]}
                            onCheckedChange={(checked) =>
                              setAssigned((current) => {
                                const next = { ...current };
                                if (checked === true)
                                  next[p.id] = p.email ? `${p.label} · ${p.email}` : p.label;
                                else delete next[p.id];
                                return next;
                              })
                            }
                            className="size-4"
                          />
                          <span className="min-w-0 break-words">
                            {p.label}
                            <small className="block text-muted-foreground">
                              {p.email ?? p.id}
                            </small>
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No matching Passports. Try another name or email, or generate
                        unassigned codes.
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </fieldset>
          <p className="mt-5 text-sm text-muted-foreground">
            Discount terms are fixed when created. Create a new code to change
            its offer.
          </p>
          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={busy}>
              {busy
                ? "Creating…"
                : kind === "special"
                  ? "Generate codes"
                  : "Create code"}
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {codes.length ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="w-full text-left text-sm">
            <TableCaption className="sr-only">
              Discount codes and participant use
            </TableCaption>
            <TableHeader className="border-b bg-muted/50 text-muted-foreground">
              <TableRow>
                {["Code", "Offer", "Uses", "Status", "Actions"].map((h) => (
                  <TableHead
                    key={h}
                    scope="col"
                    className="px-4 py-3 font-medium"
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((code) => {
                const status = !code.active
                  ? "Inactive"
                  : code.ends_at && Date.parse(code.ends_at) <= Date.now()
                    ? "Expired"
                    : code.starts_at && Date.parse(code.starts_at) > Date.now()
                      ? "Scheduled"
                      : code.max_uses !== null &&
                          code.reserved + code.redeemed >= code.max_uses
                        ? "Fully claimed"
                        : "Active";
                return (
                  <TableRow key={code.id} className="border-b last:border-0">
                    <TableCell className="px-4 py-4">
                      <Link
                        href={`/discounts/${code.id}`}
                        className="font-mono font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        {code.code}
                      </Link>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {code.kind === "special"
                          ? code.assigned_passport_id
                            ? "Assigned · single use"
                            : "Single use"
                          : "Regular"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-4">
                      <span className="font-medium">
                        {code.discount_type === "percent"
                          ? `${code.value / 100}%`
                          : peso(code.value)}{" "}
                        off
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {code.coverage === "entry"
                          ? "Entry fee"
                          : "Full subtotal"}
                        {code.absorb_fees ? " · Fees absorbed" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-4 tabular-nums">
                      {code.redeemed} redeemed
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {code.reserved} reserved ·{" "}
                        {code.max_uses === null
                          ? "Unlimited"
                          : `${Math.max(0, code.max_uses - code.reserved - code.redeemed)} left`}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-4">{status}</TableCell>
                    <TableCell className="px-4 py-4">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Copy ${code.code}`}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(code.code);
                              setCopied(code.id);
                            } catch {
                              setError(
                                "Could not copy. Select and copy the code directly.",
                              );
                            }
                          }}
                        >
                          {copied === code.id ? (
                            <Check className="size-4" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => toggle(code)}
                        >
                          {code.active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <TicketPercent className="mx-auto mb-4 size-7 text-primary" />
          <h2 className="text-lg font-semibold">
            Your first discount starts here
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Share a regular code with runners or create unique invitations with
            special fee treatment.
          </p>
        </div>
      )}
    </>
  );
}
