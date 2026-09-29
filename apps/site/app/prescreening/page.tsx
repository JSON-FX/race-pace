import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
export const dynamic = "force-dynamic";
export default async function MyScreeningRequests({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams; const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fprescreening");
  const { data, error, count } = await db.from("prescreening_batches").select("id,status,created_at,events(name)", { count: "exact" })
    .eq("booked_by_user_id", user.id).order("created_at", { ascending: false }).range((page - 1) * 20, page * 20 - 1);
  if (error) throw new Error("Requests could not be loaded");
  return <><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-10"><h1 className="text-2xl font-bold">My pre-screening requests</h1><p className="mt-2 text-sm text-muted-foreground">Review your group’s held slots and payment deadlines.</p>
    <div className="mt-6 space-y-3">{(data ?? []).map(row => <Card key={row.id} className="p-5"><Link href={`/prescreening/${row.id}`} className="flex items-center justify-between gap-3"><span className="font-semibold">{(row.events as unknown as { name: string })?.name}</span><Badge variant="secondary">{row.status === "reviewing" ? "Awaiting review" : row.status === "ready" ? "Payment window" : row.status}</Badge></Link></Card>)}</div>
    {!data?.length && <p className="mt-6">No requests yet. <Link href="/events" className="underline">Browse events</Link>.</p>}
    <nav aria-label="Request pages" className="mt-6 flex gap-4">{page > 1 && <Link className="underline" href={`/prescreening?page=${page - 1}`}>Previous</Link>}{(count ?? 0) > page * 20 && <Link className="underline" href={`/prescreening?page=${page + 1}`}>Next</Link>}</nav>
  </main></>;
}
