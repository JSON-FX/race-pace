import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { KitStation } from "./station";
export default async function RaceKitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const roles = await getMyRoles();
  if (!roles?.capabilities.includes("release_kits")) redirect("/no-access");
  const db = await createClient();
  const events: { id: string; name: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .rpc("kit_release_events")
      .range(offset, offset + 999);
    if (error)
      return (
        <div className="p-6" role="alert">
          Couldn’t load kit events. Refresh and try again.
        </div>
      );
    events.push(...data);
    if (data.length < 1000) break;
  }
  const params = await searchParams;
  const selected =
    typeof params.event === "string"
      ? events.find((e) => e.id === params.event)
      : events[0];
  return (
    <div className="fieldnotes-admin-workspace" data-fieldnotes-section="Race day / Kit desk">
      <h1 className="text-[21px] font-bold">Race kits</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Review the runner’s kit before handing it over. One complete kit per
        paid registration.
      </p>
      {events.length === 0 ? (
        <p className="mt-6">No events available for kit release.</p>
      ) : (
        <>
          <form className="my-5 flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              Event
              <select
                name="event"
                defaultValue={selected?.id ?? ""}
                className="max-w-full rounded-lg border bg-card p-2"
              >
                {!selected && <option value="">Choose an event</option>}
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-lg border bg-card px-3 py-2 text-sm font-medium">
              Switch event
            </button>
          </form>
          {selected ? (
            <KitStation key={selected.id} eventId={selected.id} />
          ) : (
            <p role="alert">
              This event is not available to your account. Choose an authorized
              event.
            </p>
          )}
        </>
      )}
    </div>
  );
}
