// Pure helper shared by lib/actions/events.ts's saveEventAction and its
// tests. Deliberately its own dependency-free module rather than living in
// lib/actions/events.ts: a "use server" file's compiler requires every
// exported function to be async (it treats every export as a Server Action
// endpoint) — a sync export like this one fails the Next build with
// "Server Actions must be async functions." Same precedent as
// lib/team-roles.ts for constants shared between a client island and a
// server action.
type WithId = { id?: string };

export function reconcileChildren<T extends WithId>(original: WithId[], current: T[]) {
  const currentIds = new Set(current.filter((c) => c.id).map((c) => c.id));
  return {
    toInsert: current.filter((c) => !c.id),
    toUpdate: current.filter((c) => c.id) as (T & { id: string })[],
    toDelete: original.filter((o) => o.id && !currentIds.has(o.id)).map((o) => o.id!) as string[],
  };
}
