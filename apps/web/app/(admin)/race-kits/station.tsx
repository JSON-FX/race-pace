"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@race-pace/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { kitError, kitState, type KitRow } from "@/lib/kit-release";
const PAGE = 50;
export function KitStation({ eventId }: { eventId: string }) {
  const db = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<KitRow[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(0);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(false),
    [message, setMessage] = useState("");
  const [review, setReview] = useState<{
    row: KitRow;
    requestId: string;
    token?: string;
  } | null>(null);
  const [present, setPresent] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [scan, setScan] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(false);
    db.rpc(
      "kit_release_roster",
      { p_event_id: eventId, p_query: query, p_state: filter },
      { count: "exact" },
    )
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .then(({ data, error, count }) => {
        if (!live) return;
        setRows((data ?? []) as KitRow[]);
        setTotal(count ?? 0);
        setLoadError(!!error);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [db, eventId, query, filter, page, revision]);
  function open(row: KitRow, token?: string) {
    setReview({ row, token, requestId: crypto.randomUUID() });
    setPresent(false);
    setReason("");
    setError("");
  }
  async function findTicket() {
    setMessage("");
    try {
      const body = JSON.parse(
        atob(scan.trim().split(".")[0].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (body.eid !== eventId || typeof body.rid !== "string") {
        setMessage(
          "This ticket belongs to another event or could not be read.",
        );
        return;
      }
      const { data, error } = await db.rpc("kit_release_roster", {
        p_event_id: eventId,
        p_query: body.rid,
        p_state: "all",
      });
      const row = (data as KitRow[] | null)?.find(
        (r) => r.registration_id === body.rid,
      );
      if (error || !row) {
        setMessage("No matching runner found for this event.");
        return;
      }
      if (row.release_id && !row.can_reverse) {
        setMessage(
          "Kit already released. Ask an organizer admin if this needs correcting.",
        );
        return;
      }
      open(row, scan.trim());
    } catch {
      setMessage("That scan did not look like a Race Pace ticket.");
    }
  }
  async function submit() {
    if (!review || busy) return;
    const { row } = review;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await db.functions.invoke("kit-release", {
        body: {
          action: row.release_id ? "reverse" : "release",
          event_id: eventId,
          registration_id: row.registration_id,
          request_id: review.requestId,
          expected_kit: row.kit,
          runner_present: present,
          release_id: row.release_id,
          reason,
          ...(review.token ? { ticket_token: review.token } : {}),
        },
      });
      if (error) {
        const context = (error as { context?: Response }).context;
        const payload = await context?.json().catch(() => null);
        setError(kitError(payload?.error ?? "server_error"));
        return;
      }
      if (!data?.ok) {
        setError(kitError(data?.error ?? "server_error"));
        return;
      }
      setMessage(
        row.release_id
          ? data.already
            ? "This release was already reversed."
            : "Release reversed. Its history has been kept."
          : data.already
            ? "Kit already released. No new release was recorded."
            : "Kit released to the runner.",
      );
      setReview(null);
      setRevision((v) => v + 1);
    } catch {
      setError(
        "The request did not finish. Retry to safely check this same release.",
      );
    } finally {
      setBusy(false);
    }
  }
  const exportUrl = `/race-kits/export?event=${eventId}&q=${encodeURIComponent(query)}&state=${filter}`;
  return (
    <>
      <Card className="gap-4 p-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
            setPage(0);
          }}
        >
          <Input
            aria-label="Search runners or bib names"
            placeholder="Search runner, bib name or registration ID"
            className="min-w-52 flex-1 border p-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="outline">Search</Button>
          <FormSelect
            aria-label="Kit status"
            className="border p-2"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All kits</option>
            <option value="unreleased">Not released</option>
            <option value="released">Released</option>
          </FormSelect>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevision((v) => v + 1)}
          >
            Refresh roster
          </Button>
          <a
            className="rounded-lg border px-3 py-2 text-sm font-medium"
            href={exportUrl}
          >
            Export CSV
          </a>
        </form>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void findTicket();
          }}
        >
          <Input
            aria-label="Scanned ticket"
            placeholder="Scan or paste the runner’s ticket"
            className="min-w-52 flex-1 border p-2"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            autoComplete="off"
          />
          <Button variant="outline">Find ticket</Button>
        </form>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {loading ? (
          <p role="status">Loading kits…</p>
        ) : loadError ? (
          <Alert role="alert"><AlertDescription>Couldn’t load the kit roster. Please refresh.</AlertDescription></Alert>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="w-full text-left">
                <TableHeader className="border-b">
                  <TableRow>
                    {["Runner", "Kit", "Status", "Action"].map((h) => (
                      <TableHead key={h} className="p-3">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.registration_id} className="border-b">
                      <TableCell className="p-3">
                        <p className="font-medium">{row.runner}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.category} · Bib name: {row.bib ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell className="p-3">
                        Shirt: {row.kit.shirt_size ?? "Not selected"}
                        <p className="text-xs text-muted-foreground">
                          {row.kit.addons.map((a) => a.name).join(", ") ||
                            "No add-ons"}
                        </p>
                      </TableCell>
                      <TableCell className="p-3">
                        {kitState(row)}
                        {row.released_at && (
                          <p className="text-xs text-muted-foreground">
                            {new Date(row.released_at).toLocaleString()}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="p-3">
                        {row.release_id ? (
                          row.can_reverse && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => open(row)}
                            >
                              Reverse release
                            </Button>
                          )
                        ) : (
                          <Button
                            size="sm"
                            disabled={
                              row.status !== "paid" || row.refund_pending
                            }
                            onClick={() => open(row)}
                          >
                            Review kit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="p-5 text-center">
                        No kits match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>{total} registrations</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>Page {page + 1}</span>
                <Button
                  variant="outline"
                  disabled={(page + 1) * PAGE >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
      <Dialog
        open={!!review}
        onOpenChange={(v) => {
          if (!v && !busy) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.row.release_id
                ? "Reverse kit release"
                : "Review complete kit"}
            </DialogTitle>
            <DialogDescription>
              {review?.row.release_id
                ? "Correct a mistaken release. The original record will remain in the history."
                : "Confirm the runner is present and the full kit matches before handing it over."}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <>
              <p className="font-semibold">{review.row.runner}</p>
              <p>Shirt: {review.row.kit.shirt_size ?? "Not selected"}</p>
              <p>
                {review.row.kit.addons.map((a) => a.name).join(", ") ||
                  "No add-ons"}
              </p>
              {review.row.release_id ? (
                <Label className="grid gap-1">
                  Reason for reversal
                  <Textarea
                    aria-label="Reason for reversal"
                    className="border p-2"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Label>
              ) : (
                <Label className="flex items-center gap-2">
                  <Checkbox

                    checked={present}
                    onCheckedChange={(checked) => setPresent(checked === true)}
                  />
                  The runner is here and I have checked the complete kit.
                </Label>
              )}
              {error && (
                <Alert variant="destructive" role="alert" className=""><AlertDescription>
                  {error}
                </AlertDescription></Alert>
              )}
              <Button
                disabled={
                  busy ||
                  (review.row.release_id
                    ? reason.trim().length < 3
                    : !present ||
                      review.row.status !== "paid" ||
                      review.row.refund_pending)
                }
                onClick={() => void submit()}
              >
                {busy
                  ? "Saving…"
                  : review.row.release_id
                    ? "Confirm reversal"
                    : "Release complete kit"}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
