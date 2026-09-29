import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent, fetchCategories } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { ScreeningRequest } from "./request-form";

export const dynamic = "force-dynamic";
export default async function NewScreeningPage({ searchParams }: { searchParams: Promise<{ event?: string; category?: string; intent?: string; roster?: string }> }) {
  const query = await searchParams;
  if (!query.event || !query.category) notFound();
  const intent = query.intent === "reservation" ? "reservation" : "entry";
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/prescreening/new?event=${query.event}&category=${query.category}&intent=${intent}`)}`);
  const [event, categories, passports] = await Promise.all([
    fetchEvent(db, query.event), fetchCategories(db, query.event),
    db.from("runner_passports").select("id,claimed_user_id,first_name,last_name").order("created_at"),
  ]);
  if (!event || !categories.some(c => c.id === query.category)) notFound();
  if (passports.error) throw new Error("Race Passports could not be loaded");
  let roster: { passportId: string; categoryId: string }[] = [];
  try {
    const requested: unknown = JSON.parse(query.roster ?? "[]");
    if (Array.isArray(requested)) roster = requested.slice(0,10).filter((p): p is {passportId:string;categoryId:string} =>
      !!p && typeof p.passportId === "string" && typeof p.categoryId === "string" &&
      !!passports.data?.some(own => own.id === p.passportId) && categories.some(c => c.id === p.categoryId));
  } catch { /* A malformed selection starts with an empty roster. */ }
  return <><SiteHeader /><ScreeningRequest event={event} categories={categories} initialCategory={query.category} intent={intent}
    passports={(passports.data ?? []).filter(p => !p.claimed_user_id || p.claimed_user_id === user.id)} userId={user.id} initialParticipants={roster} /></>;
}
