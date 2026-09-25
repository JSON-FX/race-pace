"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Search, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { initials, peso } from "@/lib/format";
import { MethodBadge } from "@/components/MethodBadge";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { ProviderBadge } from "@/components/ProviderBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  PlatformPassport, PlatformPayment, PlatformRegistration, PlatformUser,
} from "@/lib/queries/platform-users";

type Tab = "overview" | "events" | "passports";

function date(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(parsed);
}

function allRegistrations(user: PlatformUser): PlatformRegistration[] {
  const rows = new Map<string, PlatformRegistration>();
  for (const registration of user.registrations) rows.set(registration.id, registration);
  for (const passport of user.passports) {
    for (const registration of passport.registrations) rows.set(registration.id, registration);
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function latestPayment(user: PlatformUser): PlatformPayment | null {
  const payments = [user.latestPayment, ...user.passports.map((passport) => passport.latestPayment)]
    .filter((payment): payment is PlatformPayment => payment !== null);
  return payments.sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt))[0] ?? null;
}

function RegistrationLine({ registration }: { registration: PlatformRegistration }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">{registration.eventName} · {registration.category}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {date(registration.eventDate)} · Registered {date(registration.createdAt)}
        </p>
        {registration.payment ? (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <MethodBadge method={registration.payment.method} height={16} />
            <span className="text-muted-foreground">{peso(registration.payment.amountCents)}</span>
          </div>
        ) : null}
      </div>
      <StatusBadge tone={registration.status === "paid" ? "paid" : "neutral"}>
        {registration.status}
      </StatusBadge>
    </div>
  );
}

function PaymentCard({ payment }: { payment: PlatformPayment | null }) {
  if (!payment) {
    return <p className="rounded-lg border px-3 py-4 text-[13px] text-muted-foreground">No completed payment recorded.</p>;
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
      <div>
        <MethodBadge method={payment.method} height={22} />
        <p className="mt-1 text-xs text-muted-foreground">{payment.eventName} · {date(payment.paidAt)}</p>
      </div>
      <p className="font-semibold tabular-nums">{peso(payment.amountCents)}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PassportField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] font-medium text-foreground">{value || "Not provided"}</dd>
    </div>
  );
}

function PassportCard({ passport, accountEmail, defaultOpen = false }: {
  passport: PlatformPassport;
  accountEmail: string;
  defaultOpen?: boolean;
}) {
  const birthDate = passport.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(passport.dateOfBirth)
    ? date(`${passport.dateOfBirth}T12:00:00`)
    : passport.dateOfBirth;
  const barangay = passport.shippingBarangay ?? (passport.shippingBarangayCode ? `${passport.shippingBarangayCode} (code)` : null);
  return (
    <details className="group overflow-hidden rounded-lg border bg-card" open={defaultOpen || undefined}>
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <PhotoAvatar
          url={passport.avatarUrl}
          fallback={initials(passport.name)}
          className="size-9"
          fallbackClassName="bg-violet-50 text-violet-700"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{passport.name}</span>
          <span className="block text-xs leading-4 text-muted-foreground">
            {passport.relationship === "own" ? "Own Race Passport" : "Managed Race Passport"}
          </span>
          {passport.currentRegistrations[0] ? <span className="block truncate text-xs text-muted-foreground">{passport.currentRegistrations[0].eventName}</span> : null}
        </span>
        <StatusBadge tone={passport.claimed ? "paid" : "neutral"}>
          {passport.claimed ? "Claimed" : "Managed"}
        </StatusBadge>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-5 border-t px-3 pb-4 pt-4">
        <Section title="Participant details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <PassportField label="First name" value={passport.firstName} />
            <PassportField label="Last name" value={passport.lastName} />
            <PassportField label="Date of birth" value={birthDate} />
            <PassportField label="Gender" value={passport.gender ?? passport.legacyGender} />
            <PassportField label="Team" value={passport.teamName} />
            <PassportField label="Shirt size" value={passport.shirtSize} />
            <PassportField label="Blood type" value={passport.bloodType} />
            {passport.legacyFullName && !passport.firstName ? <PassportField label="Previously saved name" value={passport.legacyFullName} /> : null}
            {passport.legacyBibName ? <PassportField label="Previously saved bib name" value={passport.legacyBibName} /> : null}
          </dl>
        </Section>
        <Section title="Contact and safety">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <PassportField label={passport.relationship === "own" ? "Account email" : "Participant email (unverified)"} value={passport.relationship === "own" ? accountEmail : passport.participantEmail} />
            <PassportField label="Contact number" value={passport.contactNumber} />
            <PassportField label="Emergency contact" value={passport.emergencyContactName} />
            <PassportField label="Emergency number" value={passport.emergencyContactNumber} />
            <PassportField label="Emergency relationship" value={passport.emergencyContactRelationship} />
            {passport.legacyEmergencyContact && !passport.emergencyContactName ? <PassportField label="Previously saved emergency contact" value={passport.legacyEmergencyContact} /> : null}
          </dl>
        </Section>
        <Section title="Shipping address">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <PassportField label="Address line" value={passport.shippingAddressLine} />
            <PassportField label="Barangay" value={barangay} />
            <PassportField label="City or municipality" value={passport.shippingCity} />
            <PassportField label="Province" value={passport.shippingProvince} />
            <PassportField label="Region" value={passport.shippingRegion} />
            <PassportField label="ZIP code" value={passport.shippingZipCode} />
          </dl>
        </Section>
        <Section title="Current registrations">
          <div className="space-y-2">
            {passport.currentRegistrations.length
              ? passport.currentRegistrations.map((registration) => <RegistrationLine key={registration.id} registration={registration} />)
              : <p className="rounded-lg border px-3 py-4 text-[13px] text-muted-foreground">No current event registration.</p>}
          </div>
        </Section>
        <Section title="Most recent payment"><PaymentCard payment={passport.latestPayment} /></Section>
        <Section title="All registered events">
          <div className="space-y-2">
            {passport.registrations.length
              ? passport.registrations.map((registration) => <RegistrationLine key={registration.id} registration={registration} />)
              : <p className="rounded-lg border px-3 py-4 text-[13px] text-muted-foreground">No event registrations yet.</p>}
          </div>
        </Section>
      </div>
    </details>
  );
}

function PassportList({ user }: { user: PlatformUser }) {
  return (
    <Section title={`Race Passports managed (${user.passports.length})`}>
      <div className="space-y-2">
        {user.passports.length
          ? user.passports.map((passport, index) => <PassportCard key={passport.id} passport={passport} accountEmail={user.email} defaultOpen={index === 0} />)
          : <p className="rounded-lg border px-3 py-4 text-[13px] text-muted-foreground">No Race Passports found.</p>}
      </div>
    </Section>
  );
}

function UserInspector({
  user, open, onOpenChange, onStatusChange,
}: {
  user: PlatformUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (id: string, status: PlatformUser["status"]) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const selectedUser = user;

  const registrations = allRegistrations(selectedUser);
  const current = registrations.filter((registration) =>
    selectedUser.currentRegistrations.some((row) => row.id === registration.id)
      || selectedUser.passports.some((item) => item.currentRegistrations.some((row) => row.id === registration.id)),
  );
  const payment = latestPayment(selectedUser);
  const nextStatus = selectedUser.status === "active" ? "suspended" : "active";

  async function changeStatus() {
    setBusy(true);
    const supabase = createClient();
    const action = selectedUser.status === "active" ? "suspend" : "restore";
    const { data, error } = await supabase.functions.invoke("platform-users", {
      body: { action, user_id: selectedUser.id },
    });
    setBusy(false);
    if (error || data?.error) {
      toast.error(action === "suspend" ? "The account could not be suspended." : "The account could not be restored.");
      return;
    }
    onStatusChange(selectedUser.id, nextStatus);
    setConfirming(false);
    toast.success(nextStatus === "suspended" ? "Account suspended." : "Account restored.");
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTab("overview");
      }}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-[620px]" showCloseButton>
          <SheetHeader className="border-b px-6 pb-5 pt-6 pr-14 text-left">
            <div className="flex items-center gap-4">
              <PhotoAvatar
                url={user.avatarUrl}
                fallback={initials(user.name)}
                className="size-14"
                fallbackClassName="bg-emerald-50 text-base font-bold text-emerald-700"
              />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Registered user</p>
                <SheetTitle className="mt-1 truncate text-xl">{user.name}</SheetTitle>
                <SheetDescription className="truncate">{user.email}</SheetDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ProviderBadge provider={user.provider} />
                  <StatusBadge tone={user.status === "active" ? "paid" : "neutral"}>
                    {user.status === "active" ? "Active" : "Suspended"}
                  </StatusBadge>
                </div>
              </div>
            </div>
          </SheetHeader>

          <nav aria-label="User details" className="flex gap-0 border-b px-2 py-2 sm:gap-1 sm:px-6 sm:py-3">
            {(["overview", "events", "passports"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={tab === item ? "secondary" : "ghost"}
                className="h-11 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
                onClick={() => setTab(item)}
              >
                {item === "overview" ? "Overview" : item === "events" ? "All events" : "Race Passports"}
              </Button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {tab === "overview" ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Site member since</p>
                    <p className="mt-1 text-[13px] font-semibold">{date(user.createdAt)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sign-up method</p>
                    <div className="mt-1"><ProviderBadge provider={user.provider} /></div>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total events</p>
                    <p className="mt-1 text-[13px] font-semibold">{registrations.length}</p>
                  </div>
                </div>
                <PassportList user={user} />
                <Section title="Current registrations">
                  <div className="space-y-2">
                    {current.length
                      ? current.map((registration) => <RegistrationLine key={registration.id} registration={registration} />)
                      : <p className="rounded-lg border px-3 py-4 text-[13px] text-muted-foreground">No current event registration.</p>}
                  </div>
                </Section>
                <Section title="Most recent payment"><PaymentCard payment={payment} /></Section>
              </div>
            ) : null}

            {tab === "events" ? (
              <Section title="All registered events">
                <div className="space-y-2">
                  {registrations.length
                    ? registrations.map((registration) => <RegistrationLine key={registration.id} registration={registration} />)
                    : <p className="rounded-lg border px-3 py-4 text-[13px] text-muted-foreground">No event registrations yet.</p>}
                </div>
              </Section>
            ) : null}

            {tab === "passports" ? <PassportList user={user} /> : null}
          </div>

          <div className="flex flex-col items-stretch gap-2 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-4">
            <p className="max-w-[360px] text-xs text-muted-foreground">
              Account status changes do not alter registrations, payments, or Race Passports.
            </p>
            <Button
              variant={user.status === "active" ? "destructive" : "default"}
              className="w-full sm:w-auto"
              disabled={user.protectedAccount}
              title={user.protectedAccount ? "Super admin accounts are protected" : undefined}
              onClick={() => setConfirming(true)}
            >
              {user.status === "active" ? "Suspend user" : "Restore user"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{user.status === "active" ? `Suspend ${user.name}?` : `Restore ${user.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {user.status === "active"
                ? "They cannot sign in or refresh their session. Existing access can remain valid for up to one hour. Their registrations, payments, and Race Passports stay unchanged."
                : "They can sign in again. Their registrations, payments, and Race Passports remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={user.status === "active" ? "destructive" : "default"}
              disabled={busy}
              onClick={(event) => { event.preventDefault(); void changeStatus(); }}
            >
              {busy ? "Saving…" : user.status === "active" ? "Suspend user" : "Restore user"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function UsersDirectory({ initialUsers }: { initialUsers: PlatformUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = users.find((user) => user.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !needle || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle);
      return matchesQuery && (provider === "all" || user.provider === provider) && (status === "all" || user.status === status);
    });
  }, [users, query, provider, status]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            placeholder="Search name or email…"
            aria-label="Search users"
          />
        </div>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by sign-up method"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sign-up methods</SelectItem>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="email">Email + password</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Site member since</TableHead>
                <TableHead>Sign-up method</TableHead>
                <TableHead>Current events</TableHead>
                <TableHead>Race Passports</TableHead>
                <TableHead>Latest payment</TableHead>
                <TableHead className="w-12"><span className="sr-only">View</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((user) => {
                const registrations = allRegistrations(user);
                const current = registrations.filter((registration) =>
                  user.currentRegistrations.some((row) => row.id === registration.id)
                    || user.passports.some((passport) => passport.currentRegistrations.some((row) => row.id === registration.id)),
                );
                const payment = latestPayment(user);
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <PhotoAvatar url={user.avatarUrl} fallback={initials(user.name)} className="size-8" fallbackClassName="bg-emerald-50 font-bold text-emerald-700" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="max-w-52 truncate font-semibold">{user.name}</p>
                            {user.status === "suspended" ? <StatusBadge tone="neutral">Suspended</StatusBadge> : null}
                          </div>
                          <p className="max-w-60 truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{date(user.createdAt)}</TableCell>
                    <TableCell><ProviderBadge provider={user.provider} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5"><CalendarDays className="size-4 text-muted-foreground" />{current.length}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5"><UserRoundCheck className="size-4 text-muted-foreground" />{user.passports.length}</div>
                    </TableCell>
                    <TableCell>
                      {payment ? (
                        <div className="min-w-36">
                          <MethodBadge method={payment.method} height={18} />
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{payment.eventName}</p>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" aria-label={`View ${user.name}`} onClick={() => setSelectedId(user.id)}>
                        <ChevronRight className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-[13px] text-muted-foreground">
                    No users match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <UserInspector
        user={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        onStatusChange={(id, nextStatus) => setUsers((current) => current.map((user) => user.id === id ? { ...user, status: nextStatus } : user))}
      />
    </>
  );
}
